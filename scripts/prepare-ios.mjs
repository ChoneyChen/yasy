import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], { stdio: 'inherit' });
// iPhone releases must never replace the running Mac website's dist directory.
execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', '.local/ios-web/dist', '--emptyOutDir'], { stdio: 'inherit' });
// Personal source PDFs stay ignored. They are embedded only in this user's app.
const source = resolve(process.env.YASY_DATA_DIR || '.local', 'source-pdfs');
const destination = resolve('.local/ios-web/dist/source-pdfs');
let count = 0;
if (existsSync(source)) {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) if (/^[A-Za-z0-9_-]+\.pdf$/.test(name)) { cpSync(join(source, name), join(destination, name)); count++; }
}
console.log(`iPhone 离线资源已准备，附带 ${count} 份本机来源 PDF。学习记录和 API 密钥不会打包。`);
