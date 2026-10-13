import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const url='http://127.0.0.1:4318';
async function running() {try {const res=await fetch(url+'/api/health',{signal:AbortSignal.timeout(700)});return res.ok && (await res.json()).localOnly;}catch{return false;}}
if(await running()) {spawnSync('open',[url]);process.exit(0);}
if(!existsSync('node_modules/vite')) {const install=spawnSync('npm',['ci'],{stdio:'inherit'});if(install.status!==0) process.exit(install.status || 1);}
const build=spawnSync('npm',['run','build'],{stdio:'inherit'});if(build.status!==0) process.exit(build.status || 1);
const child=spawn(process.execPath,['server/index.mjs'],{stdio:'inherit'});
for(let i=0;i<40;i++) {if(await running()) {spawnSync('open',[url]);break;}await new Promise(r=>setTimeout(r,250));}
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>process.exit(code || 0));
