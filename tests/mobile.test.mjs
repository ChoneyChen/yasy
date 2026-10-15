import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { X509Certificate, createHash } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { MobileBridge, isLocalPeer } from '../server/mobile.mjs';
import { createApp } from '../server/index.mjs';
const bank={sources:[{id:'s',title:'Fixture',url:'https://example.invalid',type:'reported',note:'test',accessedAt:'2026-10-15'}],topics:[{id:'t',scope:'speaking',titleZh:'测试',titleEn:'Test',description:'test',tags:[]}],questions:[{id:'q',scope:'speaking',topicId:'t',sourceId:'s',sourceType:'adapted',titleZh:'测试问题',part:'Part 1',promptEn:'Do you enjoy learning?',promptZh:'喜欢学习吗？',tags:[]}]};
async function fixture(t) {
 const directory=mkdtempSync(join(tmpdir(),'yasy-mobile-'));const staticDir=join(directory,'dist');mkdirSync(staticDir);writeFileSync(join(staticDir,'index.html'),'<h1>Yasy test shell</h1>');
 const store=new Store({file:join(directory,'yasy.sqlite'),bank}); let time=Date.now();
 let bridge;bridge=new MobileBridge({dataDir:directory,port:0,bindHost:'127.0.0.1',addresses:()=>['127.0.0.1'],clock:()=>time,appFactory:requestGuard=>createApp(store,{requestGuard,mobileBridge:bridge,recoverJobs:false,staticDir})});
 const mac=createServer(createApp(store,{mobileBridge:bridge,staticDir}));await new Promise(r=>mac.listen(0,'127.0.0.1',r));
 t.after(async()=>{await bridge.stop();mac.closeAllConnections();await new Promise(r=>mac.close(r));store.close();rmSync(directory,{recursive:true,force:true});});
 const local=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(`http://127.0.0.1:${mac.address().port}${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 const remote=(path,{body,headers={},method=body===undefined?'GET':'POST'}={})=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:bridge.server.address().port,path,method,servername:'localhost',ca:readFileSync(join(directory,'mobile/server-cert.pem')),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(text);}catch{data=text;}resolve({status:res.statusCode,data,headers:res.headers});});});req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();
 });
 const pair=async()=>{const status=bridge.status();const response=await remote('/api/mobile/pair',{body:{code:status.pairing.code,deviceName:'Test iPhone'}});assert.equal(response.status,200);return response;};
 return {directory,store,bridge,local,remote,pair,advance:delta=>{time+=delta;}};
}
test('mobile access is opt-in, uses real TLS and protects the shell, APIs and original files before pairing',async t=>{
 const f=await fixture(t);assert.equal((await f.local('/api/mobile/status')).data.running,false);assert.equal(f.bridge.server,null);
 const [first,duplicate]=await Promise.all([f.local('/api/mobile/start',{}),f.local('/api/mobile/start',{})]);assert.equal(first.status,200);assert.equal(duplicate.data.port,first.data.port);
 const certificate=new X509Certificate(readFileSync(join(f.directory,'mobile/server-cert.pem')));assert.equal(first.data.fingerprint,createHash('sha256').update(certificate.raw).digest('hex'));assert.ok(certificate.checkIP('127.0.0.1'));
 for(const path of ['/','/api/state','/api/backup','/api/sources/s/file'])assert.equal((await f.remote(path)).status,401);
 assert.equal(statSync(join(f.directory,'mobile/server-key.pem')).mode&0o777,0o600);
 const paired=await f.pair();const auth={Authorization:`Bearer ${paired.data.token}`};
 assert.equal((await f.remote('/',{headers:auth})).status,200);assert.equal((await f.remote('/api/state',{headers:auth})).status,200);
 assert.equal((await f.remote('/api/mobile/session',{headers:auth})).data.ok,true);
 assert.match(paired.headers['set-cookie'][0],/HttpOnly; Secure; SameSite=Strict/);
 const saved=readFileSync(join(f.directory,'mobile/devices.json'),'utf8');assert.ok(!saved.includes(paired.data.token));assert.equal(statSync(join(f.directory,'mobile/devices.json')).mode&0o777,0o600);
 assert.equal((await f.remote('/api/mobile/pair',{body:{code:first.data.pairing.code,deviceName:'Another phone'}})).status,410);
});
test('paired cookies require a same-origin write, remote clients cannot administer pairing or use the web provider',async t=>{
 const f=await fixture(t);await f.local('/api/mobile/start',{});const paired=await f.pair();const token=paired.data.token;const auth={Authorization:`Bearer ${token}`};const cookie={Cookie:`yasy_device=${token}`};
 const origin=`https://127.0.0.1:${f.bridge.server.address().port}`;
 assert.equal((await f.remote('/api/state',{headers:cookie})).status,200);
 assert.equal((await f.remote('/api/drafts/q',{method:'PUT',headers:cookie,body:{textZh:'中文素材草稿，用来验证同源手机能够保存自己的思路。',materialIds:[]}})).status,403);
 assert.equal((await f.remote('/api/drafts/q',{method:'PUT',headers:{...cookie,Origin:origin},body:{textZh:'中文素材草稿，用来验证同源手机能够保存自己的思路。',materialIds:[]}})).status,200);
 assert.equal((await f.remote('/api/state',{headers:{...auth,Origin:'https://foreign.invalid'}})).status,403);
 assert.equal((await f.remote('/api/state',{headers:{...auth,Host:'foreign.invalid'}})).status,403);
 for(const path of ['/api/mobile/status','/api/mobile/start','/api/mobile/stop','/api/mobile/pairing-code'])assert.equal((await f.remote(path,{headers:auth,body:path.endsWith('status')?undefined:{}})).status,403);
 assert.equal((await f.remote('/api/ai/config',{headers:auth})).data.provider,'iiiapi');assert.equal(f.store.settings().provider,'web-bridge');
 assert.equal((await f.remote('/api/ai/config',{method:'PATCH',headers:auth,body:{provider:'web-bridge'}})).status,409);
 const job=await f.remote('/api/jobs',{headers:auth,body:{questionId:'q',textZh:'我很喜欢学习新东西，因为我可以和朋友交流，也可以用所学知识解决实际问题。',materialIds:[]}});
 assert.equal(job.status,200);assert.equal(job.data.job.client,'ios');assert.equal(job.data.job.provider,'iiiapi');
 assert.equal((await f.remote(`/api/jobs/${job.data.job.id}/result`,{headers:auth,body:{result:{}}})).status,409);
 assert.equal((await f.remote('/api/practice/next?kind=speaking&mode=first',{headers:auth})).data.question.id,'q');
 assert.equal((await f.remote('/api/backup',{headers:auth})).status,200);
});
test('pairing codes expire, lock after five guesses and refresh only from the Mac',async t=>{
 const f=await fixture(t);await f.local('/api/mobile/start',{});const wrong=f.bridge.status().pairing.code==='000000'?'000001':'000000';
 for(let i=0;i<5;i++)assert.equal((await f.remote('/api/mobile/pair',{body:{code:wrong,deviceName:'Test'}})).status,401);
 assert.equal((await f.remote('/api/mobile/pair',{body:{code:wrong,deviceName:'Test'}})).status,429);
 assert.equal(f.bridge.status().pairing,null);await f.local('/api/mobile/pairing-code',{});f.advance(5*60000+1);
 assert.equal((await f.remote('/api/mobile/pair',{body:{code:wrong,deviceName:'Test'}})).status,410);
 await f.local('/api/mobile/pairing-code',{});assert.equal((await f.pair()).status,200);
});
test('device revocation and expiry block every subsequent request without changing learning data',async t=>{
 const f=await fixture(t);await f.local('/api/mobile/start',{});const first=await f.pair();const auth={Authorization:`Bearer ${first.data.token}`};
 await f.local(`/api/mobile/devices/${first.data.deviceId}`,undefined,'DELETE');assert.equal((await f.remote('/api/state',{headers:auth})).status,401);
 await f.local('/api/mobile/pairing-code',{});const second=await f.pair();f.advance(31*86400000);
 assert.equal((await f.remote('/api/mobile/session',{headers:{Authorization:`Bearer ${second.data.token}`}})).status,401);assert.equal(f.store.all('answers').length,0);assert.equal(f.store.all('questions').length,1);
});
test('concurrent pairing cannot bypass the five-guess limit or consume one code twice',async t=>{
 const f=await fixture(t);await f.local('/api/mobile/start',{});
 const code=f.bridge.status().pairing.code;const wrong=code==='000000'?'000001':'000000';
 const attempts=await Promise.all(Array.from({length:12},()=>f.remote('/api/mobile/pair',{body:{code:wrong,deviceName:'Parallel guess'}})));
 assert.equal(attempts.filter(r=>r.status===401).length,5);assert.equal(attempts.filter(r=>r.status===429).length,7);
 await f.local('/api/mobile/pairing-code',{});const fresh=f.bridge.status().pairing.code;
 const pairs=await Promise.all(Array.from({length:3},()=>f.remote('/api/mobile/pair',{body:{code:fresh,deviceName:'One device'}})));
 assert.equal(pairs.filter(r=>r.status===200).length,1);assert.equal(pairs.filter(r=>r.status===410).length,2);assert.equal(f.bridge.devices.length,1);
});
test('starting or stopping phone access never marks an active answer job as interrupted',async t=>{
 const f=await fixture(t);f.store.insert('jobs',{id:'running',questionId:'q',scope:'speaking',status:'processing',createdAt:new Date().toISOString()});
 await f.local('/api/mobile/start',{});assert.equal(f.store.get('jobs','running').status,'processing');await f.local('/api/mobile/stop',{});assert.equal(f.store.get('jobs','running').status,'processing');assert.equal(f.bridge.running,false);
});
test('the LAN transport rejects public peers and never accepts a client-controlled destination host',()=>{
 for(const peer of ['127.0.0.1','::1','::ffff:192.168.0.2','10.1.1.1','172.31.255.1'])assert.equal(isLocalPeer(peer),true);
 for(const peer of ['8.8.8.8','172.32.0.1','192.168.999.1','2001:db8::1','10.1.1.1.attacker.invalid'])assert.equal(isLocalPeer(peer),false);
});
