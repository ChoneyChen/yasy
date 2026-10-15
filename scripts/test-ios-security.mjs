import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MobileBridge } from '../server/mobile.mjs';

// Isolated certificate fixture: never reads the personal database or API settings.
const directory = mkdtempSync(join(tmpdir(), 'yasy-native-security-'));
const bridge = new MobileBridge({ dataDir: directory, port: 0, bindHost: '127.0.0.1',
  addresses: () => ['192.168.99.1'], appFactory: () => (_req, res) => res.end() });
try {
  await bridge.start();
  writeFileSync(join(directory, 'cert.der'), new X509Certificate(bridge.tls.cert).raw, { mode: 0o600 });
  writeFileSync(join(directory, 'fingerprint.txt'), bridge.tls.fingerprint, { mode: 0o600 });
  await bridge.stop();
  const binary = join(directory, 'native-security-tests');
  execFileSync('xcrun', ['swiftc', resolve('ios/Yasy/PairingSecurity.swift'), resolve('ios/Tests/main.swift'), '-o', binary], { stdio: 'inherit', timeout: 120000 });
  execFileSync(binary, [directory], { stdio: 'inherit', timeout: 30000 });
} finally {
  await bridge.stop();
  rmSync(directory, { recursive: true, force: true });
}
