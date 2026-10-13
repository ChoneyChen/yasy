import { spawn } from 'node:child_process';
const children=[spawn(process.execPath,['server/index.mjs'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
let stopping=false;
function stop(code=0) {if(stopping) return;stopping=true;for(const child of children) child.kill('SIGTERM');setTimeout(()=>process.exit(code),300);}
for(const child of children) child.on('exit',code=>{if(!stopping) stop(code || 0);});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
