"use strict";
/* ===== PURE SYNC CORE (identical copy is embedded in index.html) ===== */
function deepGet(tree,path){ if(!path) return tree; var s=path.split('/'),n=tree; for(var i=0;i<s.length;i++){ if(n==null) return undefined; n=n[s[i]]; } return n; }
function deepSet(tree,path,val){ if(!path) return val; var s=path.split('/'),n=tree||{},cur=n; for(var i=0;i<s.length-1;i++){ if(typeof cur[s[i]]!=='object'||cur[s[i]]==null) cur[s[i]]={}; cur=cur[s[i]]; } cur[s[s.length-1]]=val; return n; }
function deepMerge(tree,path,val){ var node=deepGet(tree,path); var m=Object.assign({},(node&&typeof node==='object')?node:{},val); return deepSet(tree,path,m); }
function deepDelete(tree,path){ var s=path.split('/'),n=tree; for(var i=0;i<s.length-1;i++){ if(n==null) return tree; n=n[s[i]]; } if(n) delete n[s[s.length-1]]; return tree; }
function applyRest(tree,op){ tree=tree||{}; if(op.method==='PUT'){ return op.path?deepSet(tree,op.path,op.body):op.body; } if(op.method==='PATCH'){ return deepMerge(tree,op.path,op.body); } if(op.method==='DELETE'){ return deepDelete(tree,op.path); } return tree; }

function stateToTree(state){
  var tree={meta:{kids:{}},records:{},cancelled:{},cleared:{}};
  (state.kids||[]).forEach(function(k,ki){
    var kn={name:k.name,emoji:k.emoji,color:k.color,soft:k.soft,order:ki,classes:{}};
    (k.classes||[]).forEach(function(c,ci){
      kn.classes[c.id]={name:c.name,order:ci};
      var recs=c.records||{},has=false,out={};
      for(var d in recs){ if(recs[d]){ out[d]=true; has=true; } }
      if(has){ tree.records[k.id]=tree.records[k.id]||{}; tree.records[k.id][c.id]=out; }
      /* Cancelled days live in their own branch, never mixed into records.
      A cancelled class is not attendance and must never be countable as a
      star; keeping them in separate trees makes that structurally impossible
      rather than dependent on every counting site remembering to check. */
      var cans=c.cancelled||{},chas=false,cout={};
      for(var cd in cans){ if(cans[cd]){ cout[cd]=true; chas=true; } }
      if(chas){ tree.cancelled[k.id]=tree.cancelled[k.id]||{}; tree.cancelled[k.id][c.id]=cout; }
      /* Dues-cleared dates: a payment history, one leaf per date on which dues
      were settled up to and including that day. The current billing cycle is
      everything strictly AFTER the latest such date. Kept in its own branch for
      the same reason as cancellations — it must never be mistakable for
      attendance. */
      var cls2=c.cleared||{},lhas=false,lout={};
      for(var ld in cls2){ if(cls2[ld]){ lout[ld]=true; lhas=true; } }
      if(lhas){ tree.cleared[k.id]=tree.cleared[k.id]||{}; tree.cleared[k.id][c.id]=lout; }
    });
    tree.meta.kids[k.id]=kn;
  });
  return tree;
}
function treeToState(tree,prevActiveId){
  var mk=(tree&&tree.meta&&tree.meta.kids)||{}, recAll=(tree&&tree.records)||{}, canAll=(tree&&tree.cancelled)||{}, clrAll=(tree&&tree.cleared)||{};
  var kids=Object.keys(mk).map(function(id){
    var k=mk[id]||{}, classesObj=k.classes||{};
    var classes=Object.keys(classesObj).map(function(cid){
      var c=classesObj[cid]||{}, recs=(recAll[id]&&recAll[id][cid])||{}, r={};
      for(var d in recs){ if(recs[d]) r[d]=true; }
      var cans=(canAll[id]&&canAll[id][cid])||{}, x={};
      /* Attendance wins if a day is somehow in both branches. */
      for(var cd in cans){ if(cans[cd]&&!r[cd]) x[cd]=true; }
      var clrs=(clrAll[id]&&clrAll[id][cid])||{}, y={};
      for(var ld in clrs){ if(clrs[ld]) y[ld]=true; }
      return {id:cid,name:c.name,order:(c.order==null?0:c.order),records:r,cancelled:x,cleared:y};
    }).sort(function(a,b){return a.order-b.order;}).map(function(c){ delete c.order; return c; });
    return {id:id,name:k.name,emoji:k.emoji,color:k.color,soft:k.soft,order:(k.order==null?0:k.order),classes:classes};
  }).sort(function(a,b){return a.order-b.order;}).map(function(k){ delete k.order; return k; });
  var activeKidId=(prevActiveId&&kids.some(function(k){return k.id===prevActiveId;}))?prevActiveId:(kids.length?kids[0].id:null);
  return {kids:kids,activeKidId:activeKidId};
}
function opMarkDay(kidId,classId,date,val){ return val
? [{method:'DELETE',path:'cancelled/'+kidId+'/'+classId+'/'+date},{method:'PUT',path:'records/'+kidId+'/'+classId+'/'+date,body:true}]
: [{method:'DELETE',path:'records/'+kidId+'/'+classId+'/'+date}]; }
function opSetCleared(kidId,classId,date,val){ return [{method:val?'PUT':'DELETE',path:'cleared/'+kidId+'/'+classId+'/'+date,body:val?true:undefined}]; }
/* Add one day to a YYYY-MM-DD string. Uses UTC arithmetic deliberately: this
is pure calendar maths on a date string, so local time and DST must not be
allowed anywhere near it. */
function nextISO(iso){
var p=String(iso||'').split('-');
if(p.length!==3) return iso;
var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));
if(isNaN(d.getTime())) return iso;
d.setUTCDate(d.getUTCDate()+1);
return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2);
}
/* First day of the current billing cycle for a class: the day after the most
recent dues-cleared date. With no history, the cycle is all of time. */
function cycleStart(clearedObj){
var best=null;
for(var d in (clearedObj||{})){ if(clearedObj[d]&&(best===null||d>best)) best=d; }
return best===null?'0000-01-01':nextISO(best);
}
function opSetCancelled(kidId,classId,date,val){ return val
? [{method:'DELETE',path:'records/'+kidId+'/'+classId+'/'+date},{method:'PUT',path:'cancelled/'+kidId+'/'+classId+'/'+date,body:true}]
: [{method:'DELETE',path:'cancelled/'+kidId+'/'+classId+'/'+date}]; }
function opAddKid(kid,order){ return [{method:'PUT',path:'meta/kids/'+kid.id,body:{name:kid.name,emoji:kid.emoji,color:kid.color,soft:kid.soft,order:order,classes:{}}}]; }
function opEditKid(kid){ return [{method:'PATCH',path:'meta/kids/'+kid.id,body:{name:kid.name,emoji:kid.emoji,color:kid.color,soft:kid.soft}}]; }
function opDeleteKid(kidId){ return [{method:'DELETE',path:'meta/kids/'+kidId},{method:'DELETE',path:'records/'+kidId},{method:'DELETE',path:'cancelled/'+kidId},{method:'DELETE',path:'cleared/'+kidId}]; }
function opAddClass(kidId,cls,order){ return [{method:'PUT',path:'meta/kids/'+kidId+'/classes/'+cls.id,body:{name:cls.name,order:order}}]; }
function opRenameClass(kidId,classId,name){ return [{method:'PATCH',path:'meta/kids/'+kidId+'/classes/'+classId,body:{name:name}}]; }
function opDeleteClass(kidId,classId){ return [{method:'DELETE',path:'meta/kids/'+kidId+'/classes/'+classId},{method:'DELETE',path:'records/'+kidId+'/'+classId},{method:'DELETE',path:'cancelled/'+kidId+'/'+classId},{method:'DELETE',path:'cleared/'+kidId+'/'+classId}]; }

/* Does this tree actually hold roster data? Used to refuse to adopt an empty
   remote over a populated local tree (see pull()). A space that contains only
   a devices/ node is NOT data. */
function treeHasKids(tree){
  var mk=tree&&tree.meta&&tree.meta.kids;
  if(!mk||typeof mk!=='object') return false;
  return Object.keys(mk).length>0;
}

/* Data-shape version stamped into every space, so a future version of this app
   can recognise and migrate an older space instead of guessing. */
var SCHEMA=7;

/* Firebase drops empty objects, so "every kid was deleted" and "this space was
   never set up" both arrive as a missing meta node. A scalar marker survives
   both, which lets pull() tell a deliberate deletion (adopt it) from a blank
   space (re-seed it instead of wiping this phone). */
function spaceIsSeeded(tree){ return !!(tree&&tree.meta&&tree.meta.seeded); }
function metaForWrite(tree){
  var m=(tree&&tree.meta&&typeof tree.meta==='object')?tree.meta:{};
  return { kids:(m.kids&&typeof m.kids==='object')?m.kids:{}, seeded:true, schema:SCHEMA };
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
  if(!out.cancelled||typeof out.cancelled!=='object') out.cancelled={};
  if(!out.cleared||typeof out.cleared!=='object') out.cleared={};
  var bKids=(base&&base.meta&&base.meta.kids)||{}, bRec=(base&&base.records)||{}, bCan=(base&&base.cancelled)||{}, bClr=(base&&base.cleared)||{};

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
        var csrc=(bCan[bid]&&bCan[bid][bcid])||{}, cany=false;
        for(d in csrc){ if(csrc[d]){ cany=true; break; } }
        if(cany){
        if(!out.cancelled[tid]) out.cancelled[tid]={};
        if(!out.cancelled[tid][tcid]) out.cancelled[tid][tcid]={};
        for(d in csrc){ if(csrc[d]) out.cancelled[tid][tcid][d]=true; }
        }
        var lsrc=(bClr[bid]&&bClr[bid][bcid])||{}, lany=false;
        for(d in lsrc){ if(lsrc[d]){ lany=true; break; } }
        if(lany){
        if(!out.cleared[tid]) out.cleared[tid]={};
        if(!out.cleared[tid][tcid]) out.cleared[tid][tcid]={};
        for(d in lsrc){ if(lsrc[d]) out.cleared[tid][tcid][d]=true; }
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

  /* How much would this phone LOSE by adopting `remote`?
     Counts leaves (kid -> class -> day) present locally and absent remotely,
     plus kids that vanish entirely. Deliberately asymmetric: gains are ignored,
     because gaining a day from the other phone is the normal, safe case.
     pull() uses this to hold back a destructive adoption instead of applying it
     silently, which is what allowed one accidental delete (or one wrong space
     code) to wipe every phone within a single poll. */
  function adoptionLoss(local,remote){
    var lk=(local&&local.meta&&local.meta.kids)||{}, rk=(remote&&remote.meta&&remote.meta.kids)||{};
    var lr=(local&&local.records)||{}, rr=(remote&&remote.records)||{};
    var kidsLost=0, daysLost=0;
    Object.keys(lk).forEach(function(kid){ if(!rk[kid]) kidsLost++; });
    Object.keys(lr).forEach(function(kid){
      var cls=lr[kid]||{};
      Object.keys(cls).forEach(function(c){
        var days=cls[c]||{};
        Object.keys(days).forEach(function(d){
          if(!days[d]) return;
          if(!(rr[kid]&&rr[kid][c]&&rr[kid][c][d])) daysLost++;
        });
      });
    });
    var lc=(local&&local.cancelled)||{}, rc=(remote&&remote.cancelled)||{};
    var ll=(local&&local.cleared)||{}, rl=(remote&&remote.cleared)||{};
    Object.keys(ll).forEach(function(kid){
    var cls=ll[kid]||{};
    Object.keys(cls).forEach(function(c){
    var days=cls[c]||{};
    Object.keys(days).forEach(function(d){
    if(!days[d]) return;
    if(!(rl[kid]&&rl[kid][c]&&rl[kid][c][d])) daysLost++;
    });
    });
    });
    Object.keys(lc).forEach(function(kid){
    var cls=lc[kid]||{};
    Object.keys(cls).forEach(function(c){
    var days=cls[c]||{};
    Object.keys(days).forEach(function(d){
    if(!days[d]) return;
    if(!(rc[kid]&&rc[kid][c]&&rc[kid][c][d])) daysLost++;
    });
    });
    });
    return {kidsLost:kidsLost,daysLost:daysLost};
  }
  /* A single day unmarked on the other phone must NOT prompt, or the prompt
     becomes noise and gets dismissed reflexively. Losing a whole kid always
     prompts; losing days only past a threshold. */
  function lossNeedsConsent(loss){
    return !!loss && (loss.kidsLost>0 || loss.daysLost>=5);
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
      this.s.apply({method:"PUT",path:"cancelled",body:this.local.cancelled||{}});
      this.s.apply({method:"PUT",path:"cleared",body:this.local.cleared||{}});
    }
    return;
  }
  this.local={meta:(t.meta||{kids:{}}),records:(t.records||{}),cancelled:(t.cancelled||{}),cleared:(t.cleared||{})};
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
eq(metaForWrite({meta:{kids:{a:{name:"A"}}}}),{kids:{a:{name:"A"}},seeded:true,schema:SCHEMA},"metaForWrite keeps kids, adds markers");
eq(metaForWrite(null),{kids:{},seeded:true,schema:SCHEMA},"metaForWrite tolerates a null tree");
ok(typeof SCHEMA==="number"&&SCHEMA>=5,"schema version is stamped for future migrations");

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

/* ===== adoptionLoss / lossNeedsConsent =====
   These gate the "the shared space wants to remove data" prompt. Getting the
   threshold wrong in either direction is harmful: too eager and the owner is
   prompted every time the other phone unmarks a day and learns to tap through
   it; too lax and a wipe lands silently, which is the bug this exists to fix. */
(function(){
  function T(kids,recs){ return {meta:{kids:kids||{}},records:recs||{}}; }
  var K={k1:{name:"Ruhaan",classes:{c1:{name:"Phonics"}}}};
  var K2={k1:K.k1,k2:{name:"Second",classes:{}}};

  eq(adoptionLoss(T(K,{k1:{c1:{"2026-07-01":true}}}),T(K,{k1:{c1:{"2026-07-01":true}}})),
     {kidsLost:0,daysLost:0},"identical trees lose nothing");

  eq(adoptionLoss(T(K,{k1:{c1:{"2026-07-01":true}}}),T(K,{k1:{c1:{"2026-07-01":true,"2026-07-02":true}}})),
     {kidsLost:0,daysLost:0},"a day GAINED from the other phone is not a loss");

  eq(adoptionLoss(T(K,{k1:{c1:{"2026-07-01":true,"2026-07-02":true}}}),T(K,{k1:{c1:{"2026-07-01":true}}})),
     {kidsLost:0,daysLost:1},"one day unmarked elsewhere counts as one lost day");

  ok(!lossNeedsConsent(adoptionLoss(T(K,{k1:{c1:{"2026-07-01":true,"2026-07-02":true}}}),
                                    T(K,{k1:{c1:{"2026-07-01":true}}}))),
     "a single unmarked day must NOT prompt");

  var many={k1:{c1:{}}}, fewer={k1:{c1:{}}};
  for(var i=1;i<=11;i++){ many.k1.c1["2026-07-"+("0"+i).slice(-2)]=true; }
  fewer.k1.c1["2026-07-01"]=true;
  eq(adoptionLoss(T(K,many),T(K,fewer)).daysLost,10,"ten days removed are all counted");
  ok(lossNeedsConsent(adoptionLoss(T(K,many),T(K,fewer))),"a mass removal must prompt");

  /* the exact shape of the real-world failure: seeded space, all kids gone */
  var wiped={meta:{seeded:true,kids:{}},records:{}};
  eq(adoptionLoss(T(K,many),wiped),{kidsLost:1,daysLost:11},"emptied seeded space loses the kid and every day");
  ok(lossNeedsConsent(adoptionLoss(T(K,many),wiped)),"an emptied seeded space must prompt");

  /* losing a kid always prompts, even with no attendance at stake */
  eq(adoptionLoss(T(K2,{}),T(K,{})),{kidsLost:1,daysLost:0},"a deleted kid is counted with no records");
  ok(lossNeedsConsent({kidsLost:1,daysLost:0}),"losing a kid prompts even at zero days");
  ok(!lossNeedsConsent({kidsLost:0,daysLost:4}),"four days is under the threshold");
  ok(lossNeedsConsent({kidsLost:0,daysLost:5}),"five days reaches the threshold");

  /* robustness: the real caller can pass null/empty on a fresh phone */
  eq(adoptionLoss(null,null),{kidsLost:0,daysLost:0},"null trees are safe");
  eq(adoptionLoss({},{}),{kidsLost:0,daysLost:0},"empty objects are safe");
  eq(adoptionLoss(T(K,{k1:{c1:{"2026-07-01":true}}}),null),{kidsLost:1,daysLost:1},"adopting null loses everything");
  ok(!lossNeedsConsent(null),"a null loss does not prompt");
  /* falsy leaves are absences, not marks */
  eq(adoptionLoss(T(K,{k1:{c1:{"2026-07-01":false}}}),T(K,{})),{kidsLost:0,daysLost:0},"an unmarked leaf is not a loss");
})();

/* ===== CANCELLED CLASSES (v9) =====
   The hard requirement: a cancelled class must NEVER be countable as attendance.
   These tests exist to make that structural, not a matter of remembering to
   check a flag at each counting site. */
(function(){
  var srvX=new Server();
  var A=new Device(srvX,"A"), B=new Device(srvX,"B");
  A.local=stateToTree({kids:[{id:"k1",name:"Ruhaan",emoji:"X",color:"#000",soft:"#eee",
    classes:[{id:"c1",name:"Phonics",records:{}}]}],activeKidId:"k1"});
  A.queue.push({method:"PUT",path:"",body:A.local}); A.flush(); B.pull();

  /* cancelling on one phone reaches the other and stays out of records */
  A.applyOps(opSetCancelled("k1","c1","2026-08-20",true)); A.flush(); B.pull();
  eq(B.local.cancelled.k1.c1["2026-08-20"],true,"a cancellation syncs to the other phone");
  ok(!(B.local.records.k1&&B.local.records.k1.c1&&B.local.records.k1.c1["2026-08-20"]),
     "a cancelled day never appears in records");

  /* the state the UI counts from separates them */
  var st=treeToState(B.local,null), cls=st.kids[0].classes[0];
  ok(!cls.records["2026-08-20"],"treeToState keeps a cancelled day out of records");
  eq(cls.cancelled["2026-08-20"],true,"treeToState surfaces the cancelled day");

  /* marking attended must clear the cancellation, not sit alongside it */
  B.applyOps(opMarkDay("k1","c1","2026-08-20",true)); B.flush(); A.pull();
  eq(A.local.records.k1.c1["2026-08-20"],true,"marking attended sets the record");
  ok(!(A.local.cancelled.k1&&A.local.cancelled.k1.c1&&A.local.cancelled.k1.c1["2026-08-20"]),
     "marking attended CLEARS the cancellation (never both)");

  /* and the reverse direction */
  A.applyOps(opSetCancelled("k1","c1","2026-08-20",true)); A.flush(); B.pull();
  ok(!(B.local.records.k1&&B.local.records.k1.c1&&B.local.records.k1.c1["2026-08-20"]),
     "cancelling CLEARS an existing attendance mark");
  eq(B.local.cancelled.k1.c1["2026-08-20"],true,"cancelling wins after clearing attendance");

  /* even if a malformed tree has both, attendance must win in the derived state */
  var both={meta:{kids:{k1:{name:"R",classes:{c1:{name:"P",order:0}}}}},
            records:{k1:{c1:{"2026-08-21":true}}},cancelled:{k1:{c1:{"2026-08-21":true}}}};
  var c2=treeToState(both,null).kids[0].classes[0];
  eq(c2.records["2026-08-21"],true,"a day in both branches counts as attended");
  ok(!c2.cancelled["2026-08-21"],"a day in both branches is not also shown cancelled");

  /* removing a cancellation */
  B.applyOps(opSetCancelled("k1","c1","2026-08-20",false)); B.flush(); A.pull();
  ok(!(A.local.cancelled.k1&&A.local.cancelled.k1.c1&&A.local.cancelled.k1.c1["2026-08-20"]),
     "un-cancelling removes the day");

  /* concurrent, different days, one attended one cancelled — both survive */
  A.applyOps(opMarkDay("k1","c1","2026-09-01",true));
  B.applyOps(opSetCancelled("k1","c1","2026-09-02",true));
  A.flush(); B.flush(); A.pull(); B.pull();
  eq(A.local.records.k1.c1["2026-09-01"],true,"concurrent attendance survives");
  eq(A.local.cancelled.k1.c1["2026-09-02"],true,"concurrent cancellation survives");
  eq(JSON.stringify(A.local),JSON.stringify(B.local),"both phones converge with mixed marks");
})();

/* deleting a class or kid must not orphan their cancellations */
(function(){
  var t={meta:{kids:{k1:{name:"R",classes:{c1:{name:"P",order:0},c2:{name:"F",order:1}}}}},
         records:{k1:{c1:{"2026-08-01":true},c2:{"2026-08-02":true}}},
         cancelled:{k1:{c1:{"2026-08-03":true},c2:{"2026-08-04":true}}}};
  var after=opDeleteClass("k1","c1").reduce(applyRest,t);
  ok(!(after.cancelled.k1&&after.cancelled.k1.c1),"deleting a class removes its cancellations");
  eq(after.cancelled.k1.c2["2026-08-04"],true,"the other class keeps its cancellations");
  var gone=opDeleteKid("k1").reduce(applyRest,after);
  ok(!(gone.cancelled&&gone.cancelled.k1),"deleting a kid removes all their cancellations");
})();

/* backup round-trip: cancellations must survive stateToTree/treeToState */
(function(){
  var tree={meta:{kids:{k1:{name:"R",emoji:"X",color:"#000",soft:"#eee",order:0,
              classes:{c1:{name:"P",order:0}}}}},
            records:{k1:{c1:{"2026-08-05":true}}},
            cancelled:{k1:{c1:{"2026-08-06":true}}}};
  var back=stateToTree(treeToState(tree,null));
  eq(back.records.k1.c1["2026-08-05"],true,"attendance survives a state round trip");
  eq(back.cancelled.k1.c1["2026-08-06"],true,"cancellations survive a state round trip");
  /* an OLD backup with no cancelled branch must not throw */
  var old=stateToTree({kids:[{id:"k1",name:"R",classes:[{id:"c1",name:"P",records:{"2026-01-01":true}}]}]});
  eq(JSON.stringify(old.cancelled),"{}","a pre-v9 backup restores with no cancellations");
})();

/* merge must union cancellations, not drop one side */
(function(){
  var mine={meta:{kids:{k1:{name:"Ruhaan",classes:{c1:{name:"Phonics",order:0}}}}},
            records:{},cancelled:{k1:{c1:{"2026-08-10":true}}}};
  var theirs={meta:{kids:{k1:{name:"Ruhaan",classes:{c1:{name:"Phonics",order:0}}}}},
              records:{},cancelled:{k1:{c1:{"2026-08-11":true}}}};
  var m=mergeTrees(mine,theirs);
  eq(m.cancelled.k1.c1["2026-08-10"],true,"merge keeps this phone's cancellations");
  eq(m.cancelled.k1.c1["2026-08-11"],true,"merge keeps the other phone's cancellations");
})();

/* losing cancellations counts as data loss, so a wipe still prompts */
(function(){
  var local={meta:{kids:{k1:{name:"R",classes:{}}}},records:{},
             cancelled:{k1:{c1:{"1":true,"2":true,"3":true,"4":true,"5":true,"6":true}}}};
  var remote={meta:{kids:{k1:{name:"R",classes:{}}}},records:{},cancelled:{}};
  eq(adoptionLoss(local,remote).daysLost,6,"lost cancellations are counted as lost days");
  ok(lossNeedsConsent(adoptionLoss(local,remote)),"wiping cancellations still asks first");
})();

/* ===== DUES-CLEARED / BILLING CYCLES (v10) ===== */
(function(){
  /* nextISO: pure calendar arithmetic. Month, year and leap boundaries are where
     a naive implementation silently produces the wrong cycle start. */
  eq(nextISO("2026-08-17"),"2026-08-18","next day, mid-month");
  eq(nextISO("2026-08-31"),"2026-09-01","next day across a month boundary");
  eq(nextISO("2026-12-31"),"2027-01-01","next day across a year boundary");
  eq(nextISO("2028-02-28"),"2028-02-29","leap year: Feb 28 -> Feb 29");
  eq(nextISO("2028-02-29"),"2028-03-01","leap year: Feb 29 -> Mar 1");
  eq(nextISO("2026-02-28"),"2026-03-01","non-leap year: Feb 28 -> Mar 1");
  eq(nextISO("2026-04-30"),"2026-05-01","30-day month boundary");
  eq(nextISO("rubbish"),"rubbish","malformed input is returned unchanged, not NaN");

  /* cycleStart picks the LATEST cleared date and starts the day after */
  eq(cycleStart({}),"0000-01-01","no history means the cycle is all of time");
  eq(cycleStart({"2026-08-17":true}),"2026-08-18","cycle starts the day AFTER clearing");
  eq(cycleStart({"2026-06-30":true,"2026-08-17":true,"2026-07-31":true}),"2026-08-18",
     "with several entries the latest one wins, regardless of insertion order");
  eq(cycleStart({"2026-08-17":false,"2026-06-30":true}),"2026-07-01",
     "a falsy entry is ignored when finding the latest");
  eq(cycleStart({"2026-12-31":true}),"2027-01-01","cycle start crosses the year correctly");
})();

/* the cleared branch syncs, survives merge, and is not confusable with attendance */
(function(){
  var srv=new Server(), A=new Device(srv,"A"), B=new Device(srv,"B");
  A.local=stateToTree({kids:[{id:"k1",name:"R",emoji:"X",color:"#000",soft:"#eee",
    classes:[{id:"c1",name:"Phonics",records:{}}]}],activeKidId:"k1"});
  A.queue.push({method:"PUT",path:"",body:A.local}); A.flush(); B.pull();

  A.applyOps(opMarkDay("k1","c1","2026-08-10",true));
  A.applyOps(opSetCleared("k1","c1","2026-08-15",true));
  A.flush(); B.pull();
  eq(B.local.cleared.k1.c1["2026-08-15"],true,"a dues-cleared date syncs to the other phone");
  eq(B.local.records.k1.c1["2026-08-10"],true,"attendance is untouched by clearing dues");
  ok(!(B.local.records.k1.c1["2026-08-15"]),"clearing dues does NOT create an attendance record");

  var cls=treeToState(B.local,null).kids[0].classes[0];
  eq(cls.cleared["2026-08-15"],true,"treeToState surfaces the cleared date");
  eq(cycleStart(cls.cleared),"2026-08-16","the new cycle begins the day after");

  /* removing an entry reopens the cycle */
  B.applyOps(opSetCleared("k1","c1","2026-08-15",false)); B.flush(); A.pull();
  ok(!(A.local.cleared.k1&&A.local.cleared.k1.c1&&A.local.cleared.k1.c1["2026-08-15"]),
     "removing an entry deletes it");
  eq(cycleStart(treeToState(A.local,null).kids[0].classes[0].cleared),"0000-01-01",
     "removing the only entry reopens the whole history");

  /* two phones clearing different classes must not collide */
  A.applyOps(opSetCleared("k1","c1","2026-09-01",true));
  B.applyOps(opMarkDay("k1","c1","2026-09-05",true));
  A.flush(); B.flush(); A.pull(); B.pull();
  eq(JSON.stringify(A.local),JSON.stringify(B.local),"phones converge with mixed cleared/attendance ops");
})();

/* deletes must not orphan cleared dates; merge must union them */
(function(){
  var t={meta:{kids:{k1:{name:"R",classes:{c1:{name:"P",order:0},c2:{name:"F",order:1}}}}},
         records:{},cancelled:{},
         cleared:{k1:{c1:{"2026-08-01":true},c2:{"2026-08-02":true}}}};
  var a=opDeleteClass("k1","c1").reduce(applyRest,t);
  ok(!(a.cleared.k1&&a.cleared.k1.c1),"deleting a class removes its payment history");
  eq(a.cleared.k1.c2["2026-08-02"],true,"the other class keeps its history");
  var b=opDeleteKid("k1").reduce(applyRest,a);
  ok(!(b.cleared&&b.cleared.k1),"deleting a kid removes all their payment history");

  var mine={meta:{kids:{k1:{name:"R",classes:{c1:{name:"P",order:0}}}}},records:{},cancelled:{},
            cleared:{k1:{c1:{"2026-07-31":true}}}};
  var theirs={meta:{kids:{k1:{name:"R",classes:{c1:{name:"P",order:0}}}}},records:{},cancelled:{},
              cleared:{k1:{c1:{"2026-08-31":true}}}};
  var m=mergeTrees(mine,theirs);
  eq(m.cleared.k1.c1["2026-07-31"],true,"merge keeps this phone's payment history");
  eq(m.cleared.k1.c1["2026-08-31"],true,"merge keeps the other phone's payment history");
  eq(cycleStart(m.cleared.k1.c1),"2026-09-01","after merging, the latest date defines the cycle");
})();

/* a wiped payment history must still trigger the confirmation */
(function(){
  var local={meta:{kids:{k1:{name:"R",classes:{}}}},records:{},cancelled:{},
             cleared:{k1:{c1:{"1":true,"2":true,"3":true,"4":true,"5":true}}}};
  var remote={meta:{kids:{k1:{name:"R",classes:{}}}},records:{},cancelled:{},cleared:{}};
  eq(adoptionLoss(local,remote).daysLost,5,"lost payment history counts as lost days");
  ok(lossNeedsConsent(adoptionLoss(local,remote)),"wiping payment history asks first");
})();

/* backup round trip must carry the payment history */
(function(){
  var tree={meta:{kids:{k1:{name:"R",emoji:"X",color:"#000",soft:"#eee",order:0,
              classes:{c1:{name:"P",order:0}}}}},
            records:{k1:{c1:{"2026-08-05":true}}},cancelled:{},
            cleared:{k1:{c1:{"2026-08-06":true}}}};
  var back=stateToTree(treeToState(tree,null));
  eq(back.cleared.k1.c1["2026-08-06"],true,"payment history survives a state round trip");
  var old=stateToTree({kids:[{id:"k1",name:"R",classes:[{id:"c1",name:"P",records:{"2026-01-01":true}}]}]});
  eq(JSON.stringify(old.cleared),"{}","a pre-v10 backup restores with no payment history");
})();

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
