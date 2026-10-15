import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let server, exportBlob;
before(async()=>{server=await createServer({configFile:false,server:{middlewareMode:true,watch:null},appType:'custom'});({exportBlob}=await server.ssrLoadModule('/src/exportFile.ts'));});
after(async()=>{await server?.close();});
test('iOS backup export delivers the original UTF-8 bytes to its native share bridge',async()=>{
 const old=globalThis.window;const calls=[];
 try {globalThis.window={location:{search:'?client=ios'},webkit:{messageHandlers:{yasyExport:{postMessage:message=>calls.push(message)}}}};
 const content=JSON.stringify({draft:'中文素材：真实经历与观点',answer:'A complete English answer.'});
 assert.equal(await exportBlob(new Blob([content]),'yasy-backup.json'),'native');assert.equal(calls.length,1);assert.equal(calls[0].filename,'yasy-backup.json');assert.equal(Buffer.from(calls[0].base64,'base64').toString('utf8'),content);
 } finally {if(old===undefined)delete globalThis.window;else globalThis.window=old;}
});
test('an oversized native export is rejected without posting private data to WebKit',async()=>{
 const old=globalThis.window;let calls=0;
 try {globalThis.window={location:{search:'?client=ios'},webkit:{messageHandlers:{yasyExport:{postMessage:()=>calls++}}}};
 await assert.rejects(exportBlob(new Blob([new Uint8Array(50*1024*1024+1)]),'large.json'),/50 MB/);assert.equal(calls,0);
 } finally {if(old===undefined)delete globalThis.window;else globalThis.window=old;}
});
