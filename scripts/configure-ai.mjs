import { AIConfig } from '../server/ai-config.mjs';
import { Store } from '../server/store.mjs';
if(process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write('Ready for API configuration JSON on stdin (input hidden).\n');
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  input+=chunk;
  if(!input.includes('\n')) return;
  try {
    const data=JSON.parse(input.split('\n')[0]);
    const config=new AIConfig();config.update(data);
    const store=new Store();store.setSettings({provider:data.provider ?? 'iiiapi'});store.close();
    process.stdout.write('API configuration saved privately.\n');process.exit(0);
  } catch {process.stderr.write('Configuration failed. No secret was printed.\n');process.exit(1);}
});
