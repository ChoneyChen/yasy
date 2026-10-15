import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let server, createPendingDraftCache;
before(async()=>{server=await createServer({configFile:false,server:{middlewareMode:true,watch:null},appType:'custom'});({createPendingDraftCache}=await server.ssrLoadModule('/src/pendingDrafts.ts'));});
after(async()=>{await server?.close();});
test('a rapid tab switch can restore an unsynchronized draft without an older save clearing its newer edit',()=>{
 const cache=createPendingDraftCache();const first={textZh:'第一次输入',materialIds:['m1']};cache.remember('q1',first);
 const restored=cache.read('q1');assert.deepEqual(restored,first);restored.materialIds.push('mutated');assert.deepEqual(cache.read('q1').materialIds,['m1']);
 const later={textZh:'断网期间补充了新的细节',materialIds:['m1','m2']};cache.remember('q1',later);cache.observeSnapshot([{questionId:'q1',...first}]);assert.deepEqual(cache.read('q1'),later);
 // A successful PUT alone does not clear the pending value while /state is still stale.
 assert.deepEqual(cache.read('q1'),later);
 cache.observeSnapshot([{questionId:'q1',...later}]);assert.equal(cache.read('q1'),undefined);assert.equal(cache.read('q2'),undefined);
});
