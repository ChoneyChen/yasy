import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let server, createDraftSaveQueue;
before(async()=>{server=await createServer({configFile:false,server:{middlewareMode:true,watch:null},appType:'custom'});({createDraftSaveQueue}=await server.ssrLoadModule('/src/draftSaveQueue.ts'));});
after(async()=>{await server?.close();});
test('a delayed old autosave cannot finish after a newer save or job creation for the same question',async()=>{
 const queue=createDraftSaveQueue();const events=[];let release;
 const held=new Promise(resolve=>{release=resolve;});
 const old=queue.run('q1',async()=>{events.push('old-start');await held;events.push('old-finish');});
 const latest=queue.run('q1',async()=>events.push('latest-save-and-job'));
 await queue.run('q2',async()=>events.push('independent-question'));assert.deepEqual(events,['old-start','independent-question']);
 release();await Promise.all([old,latest]);assert.deepEqual(events,['old-start','independent-question','old-finish','latest-save-and-job']);
});
test('a failed save releases the queue without silently retrying that request',async()=>{
 const queue=createDraftSaveQueue();let calls=0;
 await assert.rejects(queue.run('q1',async()=>{calls++;throw new Error('offline');}),/offline/);
 await queue.run('q1',async()=>{calls++;});assert.equal(calls,2);
});
