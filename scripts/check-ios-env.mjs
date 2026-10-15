import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
const run = (command, args) => { try { return { ok: true, text: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }) }; } catch (error) { return { ok: false, text: `${error.stdout || ''}${error.stderr || ''}` }; } };
const xcode = run('xcodebuild', ['-version']);
const firstLaunch = run('xcodebuild', ['-checkFirstLaunchStatus']);
if (!xcode.ok || !firstLaunch.ok) { console.error('请打开 Xcode，由本人阅读并接受协议、完成首次组件安装，然后重试。'); process.exit(1); }
const sdks = run('xcodebuild', ['-showsdks']);
const runtimes = run('xcrun', ['simctl', 'list', 'runtimes', '--json']);
const identities = run('security', ['find-identity', '-v', '-p', 'codesigning']);
mkdirSync('.local/qa', { recursive: true }); const deviceFile = resolve('.local/qa/ios-env-devices.json');
const deviceResult = run('xcrun', ['devicectl', 'list', 'devices', '--json-output', deviceFile]);
let devices = [];
if (deviceResult.ok) { chmodSync(deviceFile, 0o600); const data = JSON.parse(readFileSync(deviceFile, 'utf8')); devices = (data.result?.devices || []).map(d => ({ name: d.deviceProperties?.name, iOS: d.deviceProperties?.osVersionNumber, paired: d.connectionProperties?.pairingState, developerMode: d.deviceProperties?.developerModeStatus })); }
console.log(JSON.stringify({ xcode: xcode.text.trim(), firstLaunchReady: true, iOSSDK: /iphoneos/.test(sdks.text), simulatorSDK: /iphonesimulator/.test(sdks.text), availableRuntimes: runtimes.ok ? JSON.parse(runtimes.text).runtimes.filter(r => r.isAvailable).map(r => r.name) : [], validSigningIdentities: Number(identities.text.match(/(\d+) valid identities found/)?.[1] || 0), devices, project: 'ios/Yasy.xcodeproj', minimumIOS: '17.0' }, null, 2));
