"use strict";
/* ===== PURE SYNC CORE (identical copy is embedded in attendance.html) ===== */
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
      var recs=c.records||{}, has=false, out={};
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
Device.prototype.pull=function(){ if(this.queue.length) this.flush(); var t=this.s.get(); if(t!==null){ this.local=t; } };
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

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
