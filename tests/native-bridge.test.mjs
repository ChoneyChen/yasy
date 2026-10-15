import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let server, nativeRoute, nativeAppearance, postNativeNavigation;
before(async()=>{server=await createServer({configFile:false,server:{middlewareMode:true,watch:null},appType:'custom'});({nativeRoute,nativeAppearance,postNativeNavigation}=await server.ssrLoadModule('/src/nativeBridge.ts'));});
after(async()=>{await server?.close();});
test('native navigation admits only learning destinations with monotonic-ticket-compatible values',()=>{
 assert.deepEqual(nativeRoute({view:'speaking',ticket:4,extra:'ignored'}),{view:'speaking',ticket:4});
 for(const value of [null,{}, {view:'https://foreign.invalid'}, {view:'today',ticket:-1},{view:'today',ticket:1.5}])assert.equal(nativeRoute(value),null);
});
test('system accessibility preferences preserve 200 percent text and reject invalid scale values',()=>{
 assert.deepEqual(nativeAppearance({fontScale:2,reduceMotion:true,reduceTransparency:true,increaseContrast:true,boldText:true}),{fontScale:2,reduceMotion:true,reduceTransparency:true,increaseContrast:true,boldText:true});
 assert.equal(nativeAppearance({fontScale:NaN}).fontScale,1);assert.equal(nativeAppearance({fontScale:100}).fontScale,3.2);assert.equal(nativeAppearance({fontScale:-3}).fontScale,.8);assert.equal(nativeAppearance({reduceMotion:'false'}).reduceMotion,false);
});
test('native chrome receives only bounded navigation metadata and the desktop does not post',()=>{
 const old=globalThis.window;const calls=[];
 try {
  globalThis.window={location:{search:'?client=ios'},webkit:{messageHandlers:{yasyNavigation:{postMessage:value=>calls.push(value)}}}};
  assert.equal(postNativeNavigation({view:'today',canGoBack:true,backgroundCount:2,title:'口语练习',ticket:3,draft:'PRIVATE DRAFT'}),true);
  assert.deepEqual(calls,[{view:'today',canGoBack:true,backgroundCount:2,title:'口语练习',ticket:3}]);
  window.location.search='';assert.equal(postNativeNavigation({view:'today',canGoBack:false,backgroundCount:0,title:'今日积累',ticket:0}),false);assert.equal(calls.length,1);
 }finally {if(old===undefined)delete globalThis.window;else globalThis.window=old;}
});
