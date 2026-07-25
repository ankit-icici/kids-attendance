"use strict";
/* ===== PURE SYNC CORE (identical copy is embedded in index.html) ===== */
function deepGet(tree,path){ if(!path) return tree; var s=path.split('/'),n=tree; for(var i=0;i<s.length;i++){ if(n==null) return undefined; n=n[s[i]]; } return n; }
function deepSet(tree,path,val){ if(!path) return val; var s=path.split('/'),n=tree||{},cur=n; for(var i=0;i<s.length-1;i++){ if(typeof cur[s[i]]!=='object'||cur[s[i]]==null) cur[s[i]]={}; cur=cur[s[i]]; } cur[s[s.length-1]]=val; return n; }
function deepMerge(tree,path,val){ var node=deepGet(tree,path); var m=Object.assign({},(node&&typeof node==='object')?node:{},val); return deepSet(tree,path,m); }
function deepDelete(tree,path){ var s=path.split('/'),n=tree; for(var i=0;i<s.length-1;i++){ if(n==null) return tree; n=n[s[i]]; } if(n) delete n[s[s.length-1]]; return tree; }
function applyRest(tree,op){ tree=tree||{}; if(op.method==='PUT'){ return op.path?deepSet(tree,op.path,op.body):op.body; } if(op.method==='PATCH'){ return deepMerge(tree,op.path,op.body); } if(op.method==='DELETE'){ return deepDelete(tree,op.path); } return tree; }

function stateToTree(state){
  var tree={meta:{kids:{}},records:{}};
  (state.kids||[]).forEach(function(k,ki){
    var kn={name:k.name,emoji:k.emoji,color:k.color,soft:k.soft,order:ki,classes:{}};
    (k.classes||[]).forEach(function(c,ci){
      kn.classes[c.id]={name:c.name,order:ci};
      var recs=c.records||{},has=false,out={};
      for(var d in recs){ if(recs[d]){ out[d]=true; has=true; } }
      if(has){ tree.records[k.id]=tree.records[k.id]||{}; tree.records[k.id][c.id]=out; }
    });
    tree.meta.kids[k.id]=kn;
  });
  return tree;
}
function treeToState(tree,prevActiveId){
  var mk=(tree&&tree.meta&&tree.meta.kids)||{}, recAll=(tree&&tree.records)||{};
  var kids=Object.keys(mk).map(function(id){
    var k=mk[id]||{}, classesObj=k.classes||{};
    var classes=Object.keys(classesObj).map(function(cid){
      var c=classesObj[cid]||{}, recs=(recAll[id]&&recAll[id][cid])||{}, r={};
      for(var d in recs){ if(recs[d]) r[d]=true; }
      return {id:cid,name:c.name,order:(c.order==null?0:c.order),records:r};
    }).sort(function(a,b){return a.order-b.order;}).map(function(c){ delete c.order; return c; });
    return {id:id,name:k.name,emoji:k.emoji,color:k.color,soft:k.soft,order:(k.order==null?0:k.order),classes:classes};
  }).sort(function(a,b){return a.order-b.order;}).map(function(k){ delete k.order; return k; });
  var activeKidId=(prevActiveId&&kids.some(function(k){return k.id===prevActiveId;}))?prevActiveId:(kids.length?kids[0].id:null);
  return {kids:kids,activeKidId:activeKidId};
}

function opMarkDay(kidId,classId,date,val){ return [{method:val?'PUT':'DELETE',path:'records/'+kidId+'/'+classId+'/'+date,body:val?true:undefined}]; }
function opAddKid(kid,order){ return [{method:'PUT',path:'meta/kids/'+kid.id,body:{name:kid.name,emoji:kid.emoji,color:kid.color,soft:kid.soft,order:order,classes:{}}}]; }
function opEditKid(kid){ return [{method:'PATCH',path:'meta/kids/'+kid.id,body:{name:kid.name,emoji:kid.emoji,color:kid.color,soft:kid.soft}}]; }
function opDeleteKid(kidId){ return [{method:'DELETE',path:'meta/kids/'+kidId},{method:'DELETE',path:'records/'+kidId}]; }
function opAddClass(kidId,cls,order){ return [{method:'PUT',path:'meta/kids/'+kidId+'/classes/'+cls.id,body:{name:cls.name,order:order}}]; }
function opRenameClass(kidId,classId,name){ return [{method:'PATCH',path:'meta/kids/'+kidId+'/classes/'+classId,body:{name:name}}]; }
function opDeleteClass(kidId,classId){ return [{method:'DELETE',path:'meta/kids/'+kidId+'/classes/'+classId},{method:'DELETE',path:'records/'+kidId+'/'+classId}]; }

/* Does this tree actually hold roster data? Used to refuse to adopt an empty
   remote over a populated local tree (see pull()). A space that contains only
   a devices/ node is NOT data. */
function treeHasKids(tree){
  var mk=tree&&tree.meta&&tree.meta.kids;
  if(!mk||typeof mk!=='object') return false;
  return Object.keys(mk).length>0;
}

/* Firebase drops empty objects, so "every kid was deleted" and "this space was
   never set up" both arrive as a missing meta node. A scalar marker survives
   both, which lets pull() tell a deliberate deletion (adopt it) from a blank
   space (re-seed it instead of wiping this phone). */
function spaceIsSeeded(tree){ return !!(tree&&tree.meta&&tree.meta.seeded); }
function metaForWrite(tree){
  var m=(tree&&tree.meta&&typeof tree.meta==='object')?tree.meta:{};
  return { kids:(m.kids&&typeof m.kids==='object')?m.kids:{}, seeded:true };
}

function normName(s){ return String(s==null?"":s).trim().toLowerCase().replace(/\s+/g,' '); }

/* Union-merge two trees. `incoming` (the shared space) wins on scalar
   conflicts; nothing is ever dropped. Kids and classes are matched by id
   first, then by normalised name — so two phones that each created their own
   "Ruhaan" / "Phonics" fold into one instead of duplicating. Records are a
   union: a day marked on either phone stays marked. */
function mergeTrees(base,incoming){
  var out=JSON.parse(JSON.stringify(incoming||{}));
  if(!out.meta||typeof out.meta!=='object') out.meta={};
  if(!out.meta.kids||typeof out.meta.kids!=='object') out.meta.kids={};
  if(!out.records||typeof out.records!=='object') out.records={};
  var bKids=(base&&base.meta&&base.meta.kids)||{}, bRec=(base&&base.records)||{};

  var maxKidOrder=-1, kidByName={};
  Object.keys(out.meta.kids).forEach(function(id){
    var k=out.meta.kids[id]||{}, o=(k.order==null?0:k.order);
    if(o>maxKidOrder) maxKidOrder=o;
    var n=normName(k.name); if(n&&kidByName[n]===undefined) kidByName[n]=id;
  });

  Object.keys(bKids).forEach(function(bid){
    var bKid=bKids[bid]||{}, bn=normName(bKid.name);
    var tid = out.meta.kids[bid] ? bid : (kidByName[bn]!==undefined ? kidByName[bn] : null);
    if(tid===null){
      tid=bid; maxKidOrder++;
      out.meta.kids[tid]={name:bKid.name,emoji:bKid.emoji,color:bKid.color,soft:bKid.soft,order:maxKidOrder,classes:{}};
      if(bn) kidByName[bn]=tid;
    }
    var tKid=out.meta.kids[tid];
    if(!tKid.classes||typeof tKid.classes!=='object') tKid.classes={};

    var maxClsOrder=-1, clsByName={};
    Object.keys(tKid.classes).forEach(function(cid){
      var c=tKid.classes[cid]||{}, o=(c.order==null?0:c.order);
      if(o>maxClsOrder) maxClsOrder=o;
      var n=normName(c.name); if(n&&clsByName[n]===undefined) clsByName[n]=cid;
    });

    var bClasses=bKid.classes||{};
    Object.keys(bClasses).forEach(function(bcid){
      var bCls=bClasses[bcid]||{}, cn=normName(bCls.name);
      var tcid = tKid.classes[bcid] ? bcid : (clsByName[cn]!==undefined ? clsByName[cn] : null);
      if(tcid===null){
        tcid=bcid; maxClsOrder++;
        tKid.classes[tcid]={name:bCls.name,order:maxClsOrder};
        if(cn) clsByName[cn]=tcid;
      }
      var src=(bRec[bid]&&bRec[bid][bcid])||{}, any=false, d;
      for(d in src){ if(src[d]){ any=true; break; } }
      if(any){
        if(!out.records[tid]) out.records[tid]={};
        if(!out.records[tid][tcid]) out.records[tid][tcid]={};
        for(d in src){ if(src[d]) out.records[tid][tcid][d]=true; }
      }
    });
  });
  return out;
}

/* Short human-comparable id for a space. Two phones on the same space always
   show the same 4 characters; any difference in URL or code (including a
   difference in capitalisation of the code) shows up immediately. Host case
   is normalised because DNS is case-insensitive; the code's case is NOT,
   because Firebase paths are case-sensitive. */
function spaceFingerprint(dbUrl,code){
  var s=String(dbUrl==null?"":dbUrl).trim().replace(/\/+$/,"").toLowerCase()+"|"+String(code==null?"":code);
  var h=0x811c9dc5;
  for(var i=0;i<s.length;i++){ h=(h^s.charCodeAt(i))>>>0; h=(h*16777619)>>>0; }
  return (("0000"+h.toString(36).toUpperCase()).slice(-4));
}

/* ===== TEST HARNESS ===== */
var pass=0, fail=0;
function eq(a,b,msg){ var A=JSON.stringify(a),B=JSON.stringify(b); if(A===B){pass++;} else {fail++; console.log("FAIL: "+msg+"\n  got : "+A+"\n  want: "+B);} }
function ok(c,msg){ if(c){pass++;} else {fail++; console.log("FAIL: "+msg);} }

/* fake firebase: a single shared tree; devices apply the same op locally + on server */
function Server(){ this.tree=null; }
Server.prototype.apply=function(op){ this.tree=applyRest(this.tree||{},op); };
Server.prototype.get=function(){ return this.tree?JSON.parse(JSON.stringify(this.tree)):null; };

function Device(server,name){ this.s=server; this.name=name; this.local=null; this.active=null; this.queue=[]; }
Device.prototype.applyOps=function(ops){ var self=this; ops.forEach(function(op){ self.local=applyRest(self.local||{},op); self.queue.push(op); }); };
Device.prototype.flush=function(){ var self=this; this.queue.forEach(function(op){ self.s.apply(op); }); this.queue=[]; };
/* Mirrors the real pull(): refuses to adopt a blank space over local data, but
   does adopt a space that is empty *and* carries the seeded marker. */
Device.prototype.pull=function(){
  if(this.queue.length) this.flush();
  var t=this.s.get();
  if(!treeHasKids(t)&&!spaceIsSeeded(t)){
    if(treeHasKids(this.local)){
      this.s.apply({method:"PUT",path:"meta",body:metaForWrite(this.local)});
      this.s.apply({method:"PUT",path:"records",body:this.local.records||{}});
    }
    return;
  }
  this.local={meta:(t.meta||{kids:{}}),records:(t.records||{})};
};
Device.prototype.state=function(){ return treeToState(this.local, this.active); };

/* --- Test 1: state <-> tree round trip preserves data & order --- */
var s0={ kids:[
  {id:"k1",name:"Aria",emoji:"🦄",color:"#E85D9A",soft:"#FCE7F1",classes:[
    {id:"c1",name:"Piano",records:{"2026-07-01":true,"2026-07-03":true}},
    {id:"c2",name:"Swim",records:{"2026-07-02":true}}]},
  {id:"k2",name:"Ben",emoji:"🦖",color:"#3B9BE8",soft:"#E2F0FC",classes:[
    {id:"c3",name:"Chess",records:{}}]}
], activeKidId:"k2"};
var round=treeToState(stateToTree(s0),"k2");
eq(round.kids.length,2,"roundtrip kid count");
eq(round.kids[0].name,"Aria","roundtrip order kid0");
eq(round.kids[1].name,"Ben","roundtrip order kid1");
eq(round.kids[0].classes.map(function(c){return c.name;}),["Piano","Swim"],"roundtrip class order");
eq(round.kids[0].classes[0].records,{"2026-07-01":true,"2026-07-03":true},"roundtrip records");
eq(Object.keys(round.kids[0].classes[1].records).length,1,"roundtrip swim records");
eq(round.activeKidId,"k2","roundtrip active preserved");

/* --- Test 2: two devices, concurrent marks on DIFFERENT days both survive --- */
var srv=new Server();
var A=new Device(srv,"A"), B=new Device(srv,"B");
// A seeds the space with initial roster (no records yet)
A.local=stateToTree({kids:[{id:"k1",name:"Aria",emoji:"🦄",color:"#E85D9A",soft:"#FCE7F1",classes:[{id:"c1",name:"Piano",records:{}}]}],activeKidId:"k1"});
A.queue.push({method:"PUT",path:"",body:A.local}); A.flush();
B.pull(); // B joins, gets roster
eq(B.state().kids[0].name,"Aria","B sees roster after join");

// concurrent: A marks Jul 10, B marks Jul 11 (offline-ish: both queue, then flush)
A.applyOps(opMarkDay("k1","c1","2026-07-10",true));
B.applyOps(opMarkDay("k1","c1","2026-07-11",true));
A.flush(); B.flush();
A.pull(); B.pull();
var recsA=A.state().kids[0].classes[0].records;
var recsB=B.state().kids[0].classes[0].records;
eq(recsA,{"2026-07-10":true,"2026-07-11":true},"A sees both concurrent marks");
eq(recsB,{"2026-07-10":true,"2026-07-11":true},"B sees both concurrent marks");

/* --- Test 3: unmark on one device propagates --- */
B.applyOps(opMarkDay("k1","c1","2026-07-10",false)); B.flush(); A.pull();
eq(A.state().kids[0].classes[0].records,{"2026-07-11":true},"A sees B's unmark");

/* --- Test 4: add kid on B, add class on A, both converge --- */
B.applyOps(opAddKid({id:"k2",name:"Ben",emoji:"🦖",color:"#3B9BE8",soft:"#E2F0FC"},1)); B.flush();
A.applyOps(opAddClass("k1",{id:"c9",name:"Art"},1)); A.flush();
A.pull(); B.pull();
eq(A.state().kids.map(function(k){return k.name;}),["Aria","Ben"],"A sees new kid Ben");
eq(A.state().kids[0].classes.map(function(c){return c.name;}),["Piano","Art"],"A sees new class Art");
eq(B.state().kids[0].classes.map(function(c){return c.name;}),["Piano","Art"],"B sees new class Art");

/* --- Test 5: rename + edit kid (PATCH) keeps classes intact --- */
A.applyOps(opRenameClass("k1","c1","Grand Piano")); A.flush();
B.applyOps(opEditKid({id:"k1",name:"Aria R",emoji:"🌟",color:"#7A5CF0",soft:"#EEE9FE"})); B.flush();
A.pull(); B.pull();
eq(A.state().kids[0].name,"Aria R","kid edited name");
eq(A.state().kids[0].classes[0].name,"Grand Piano","class renamed, not lost by kid PATCH");
eq(A.state().kids[0].classes.length,2,"kid still has both classes after PATCH");

/* --- Test 6: delete class removes its records --- */
A.applyOps(opDeleteClass("k1","c1")); A.flush(); B.pull();
eq(B.state().kids[0].classes.map(function(c){return c.name;}),["Art"],"class deleted");
ok(!(B.local.records["k1"] && B.local.records["k1"]["c1"]),"deleted class records gone");

/* --- Test 7: delete kid removes kid + records --- */
B.applyOps(opDeleteKid("k2")); B.flush(); A.pull();
eq(A.state().kids.map(function(k){return k.name;}),["Aria R"],"kid deleted");

/* --- Test 8: joining an EMPTY space seeds it (null tree handling) --- */
var srv2=new Server(); var C=new Device(srv2,"C");
C.pull(); // empty -> stays null/empty
eq(C.state().kids,[], "empty space -> no kids");
C.local=stateToTree({kids:[{id:"kx",name:"Zoe",emoji:"🐼",color:"#3BAF5A",soft:"#E4F6EA",classes:[]}],activeKidId:"kx"});
C.queue.push({method:"PUT",path:"",body:C.local}); C.flush();
var D=new Device(srv2,"D"); D.pull();
eq(D.state().kids[0].name,"Zoe","D joins seeded space");

/* --- Test 9: treeHasKids / seeded marker / metaForWrite --- */
ok(!treeHasKids(null),"null tree has no kids");
ok(!treeHasKids({}),"empty tree has no kids");
ok(!treeHasKids({devices:{d1:{name:"Dad's phone"}}}),"a devices-only space is not data");
ok(!treeHasKids({meta:{kids:{}}}),"empty kids map is not data");
ok(treeHasKids({meta:{kids:{k1:{name:"A"}}}}),"tree with a kid is data");
ok(!spaceIsSeeded({meta:{kids:{}}}),"unseeded space detected");
ok(spaceIsSeeded({meta:{seeded:true}}),"seeded space detected");
eq(metaForWrite({meta:{kids:{a:{name:"A"}}}}),{kids:{a:{name:"A"}},seeded:true},"metaForWrite keeps kids, adds marker");
eq(metaForWrite(null),{kids:{},seeded:true},"metaForWrite tolerates a null tree");

/* --- Test 10: space fingerprint is comparable across phones --- */
var U="https://example-default-rtdb.firebaseio.com";
eq(spaceFingerprint(U,"ruhaan-7").length,4,"fingerprint is 4 characters");
eq(spaceFingerprint(U,"ruhaan-7"),spaceFingerprint(U+"/","ruhaan-7"),"trailing slash ignored");
eq(spaceFingerprint(U.toUpperCase(),"ruhaan-7"),spaceFingerprint(U,"ruhaan-7"),"host capitalisation ignored");
ok(spaceFingerprint(U,"ruhaan-7")!==spaceFingerprint(U,"Ruhaan-7"),"code capitalisation changes the space");
ok(spaceFingerprint(U,"ruhaan-7")!==spaceFingerprint(U,"ruhaan_7"),"separator difference changes the space");
ok(spaceFingerprint(U,"ruhaan-7")!==spaceFingerprint("https://other-rtdb.firebaseio.com","ruhaan-7"),"different database changes the space");

/* --- Test 11: a blank space must never wipe a phone that has data --- */
var srv3=new Server(), E=new Device(srv3,"E"), F=new Device(srv3,"F");
E.local=stateToTree({kids:[{id:"ke",name:"Ravi",emoji:"🦁",color:"#EF5350",soft:"#FDE6E5",classes:[
  {id:"ce",name:"Chess",records:{"2026-03-01":true,"2026-03-02":true}}]}]});
E.pull();
eq(E.state().kids.length,1,"blank space does not wipe local data");
eq(Object.keys(E.state().kids[0].classes[0].records).length,2,"local records survive a blank space");
ok(spaceIsSeeded(srv3.get()),"blank space gets re-seeded from the phone that has data");
F.pull();
eq(F.state().kids[0].name,"Ravi","second phone receives the re-seeded roster");
eq(Object.keys(F.state().kids[0].classes[0].records).length,2,"second phone receives the records");

/* --- Test 12: deleting the last kid still propagates (not mistaken for blank) --- */
F.applyOps(opDeleteKid("ke")); F.flush(); E.pull();
eq(E.state().kids,[],"a deliberate delete-all still reaches the other phone");

/* --- Test 13: mergeTrees on the real-world case — two phones that each
       created their own kid, in two different spaces, same names --- */
var phoneW=stateToTree({kids:[{id:"kA",name:"Ruhaan",emoji:"🐵",color:"#3BAF5A",soft:"#E4F6EA",classes:[
  {id:"cA1",name:"Phonics",records:{"2026-07-19":true,"2026-07-20":true,"2026-07-21":true,"2026-07-22":true,"2026-07-23":true,"2026-07-24":true}},
  {id:"cA2",name:"Fitbuds",records:{}}]}]});
var phoneH=stateToTree({kids:[{id:"kB",name:"Ruhaan",emoji:"🐰",color:"#3BAF5A",soft:"#E4F6EA",classes:[
  {id:"cB1",name:"Phonics",records:{"2026-07-25":true}},
  {id:"cB2",name:"Fitbuds",records:{}}]}]});
var mergedTree=mergeTrees(phoneH,phoneW); // phone H joins phone W's space and merges
var mg=treeToState(mergedTree,null);
eq(mg.kids.length,1,"same-named kids fold into one, no duplicate Ruhaan");
eq(mg.kids[0].emoji,"🐵","shared space wins on the avatar, so both phones match");
eq(mg.kids[0].classes.map(function(c){return c.name;}),["Phonics","Fitbuds"],"same-named classes fold, no duplicates");
eq(Object.keys(mg.kids[0].classes[0].records).length,7,"all 6+1 marked days survive the merge");
ok(mg.kids[0].classes[0].records["2026-07-19"]===true,"shared space's day survives");
ok(mg.kids[0].classes[0].records["2026-07-25"]===true,"joining phone's day survives");

/* --- Test 14: merge keeps kids/classes that exist on only one side --- */
var phoneZ=stateToTree({kids:[
  {id:"kB",name:"Ruhaan",emoji:"🐰",color:"#3BAF5A",soft:"#E4F6EA",classes:[{id:"cB3",name:"Swimming",records:{"2026-06-01":true}}]},
  {id:"kZ",name:"Zoya",emoji:"🐼",color:"#3BAF5A",soft:"#E4F6EA",classes:[{id:"cz",name:"Art",records:{"2026-01-02":true}}]}]});
var mg2=treeToState(mergeTrees(phoneZ,phoneW),null);
eq(mg2.kids.map(function(k){return k.name;}),["Ruhaan","Zoya"],"kid that exists on only one phone is kept");
eq(mg2.kids[0].classes.map(function(c){return c.name;}),["Phonics","Fitbuds","Swimming"],"differently-named class is added, not folded");
eq(Object.keys(mg2.kids[0].classes[2].records),["2026-06-01"],"records follow a one-sided class");
eq(Object.keys(mg2.kids[1].classes[0].records),["2026-01-02"],"records follow a one-sided kid");

/* --- Test 15: merge is idempotent and does not mutate its inputs --- */
eq(mergeTrees(phoneW,phoneW),phoneW,"merging a tree with itself is a no-op");
var snapH=JSON.stringify(phoneH), snapW=JSON.stringify(phoneW);
mergeTrees(phoneH,phoneW);
eq(JSON.parse(snapH),phoneH,"merge does not mutate the local tree");
eq(JSON.parse(snapW),phoneW,"merge does not mutate the shared tree");

/* --- Test 16: name matching is whitespace/case tolerant --- */
var mg3=treeToState(mergeTrees(
  stateToTree({kids:[{id:"kX",name:"  ruhaan ",emoji:"🐰",color:"#3BAF5A",soft:"#E4F6EA",classes:[
    {id:"cX",name:"PHONICS",records:{"2026-05-05":true}}]}]}), phoneW),null);
eq(mg3.kids.length,1,"kid name match ignores case and surrounding spaces");
eq(mg3.kids[0].classes.length,2,"class name match ignores case");
ok(mg3.kids[0].classes[0].records["2026-05-05"]===true,"records merged across the case difference");

/* --- Test 17: the copy of the sync core above must be identical to the one
       embedded in index.html. This is the safety net described in README.md;
       checking it here means the two copies cannot quietly drift apart.
       Skipped (not failed) if index.html isn't sitting next to this file. --- */
(function driftCheck(){
  var fs=require("fs"), path=require("path");
  var htmlPath=path.join(__dirname,"index.html"), html;
  try{ html=fs.readFileSync(htmlPath,"utf8"); }
  catch(e){ console.log("NOTE: index.html not found next to this file — drift check skipped."); return; }

  function slice(src,start,end){
    var a=src.indexOf(start); if(a<0) return null;
    var b=src.indexOf(end,a+start.length); if(b<0) return null;
    return src.slice(a+start.length,b);
  }
  function norm(s){
    return s.split("\n").map(function(l){ return l.trim(); })
            .filter(function(l){ return l.length>0; });
  }
  var fromHtml=slice(html,"/* ================= PURE SYNC CORE (unit-tested separately) ================= */",
                          "/* ================= CONSTANTS ================= */");
  var fromTest=slice(fs.readFileSync(__filename,"utf8"),
                          "/* ===== PURE SYNC CORE (identical copy is embedded in index.html) ===== */",
                          "/* ===== TEST HARNESS ===== */");
  if(fromHtml===null||fromTest===null){ fail++; console.log("FAIL: could not locate the sync-core block in one of the files"); return; }

  var A=norm(fromHtml), B=norm(fromTest);
  if(A.join("\n")===B.join("\n")){ pass++; return; }
  fail++;
  console.log("FAIL: sync core in index.html and synccore.test.js have DRIFTED.");
  var n=Math.max(A.length,B.length), shown=0;
  for(var i=0;i<n&&shown<8;i++){
    if(A[i]!==B[i]){
      shown++;
      console.log("  line "+(i+1)+"\n    index.html : "+(A[i]===undefined?"(missing)":A[i])+
                            "\n    test file  : "+(B[i]===undefined?"(missing)":B[i]));
    }
  }
})();

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
