import { createServer } from 'node:https';
import { randomBytes, randomInt, createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AppError, assert } from './domain.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const cookieName = 'yasy_device';
const privateIPv4 = value => /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(value) && value.split('.').length === 4 && value.split('.').every(n => /^\d+$/.test(n) && Number(n) <= 255);
export const isLocalPeer = address => address === '::1' || privateIPv4(String(address || '').replace(/^::ffff:/, ''));
export function mobileAddresses() {
  return [...new Set(Object.entries(networkInterfaces()).filter(([name]) => !/^(?:utun|lo|awdl|llw)/.test(name)).flatMap(([, list]) => (list || []).filter(item => item.family === 'IPv4' && !item.internal && privateIPv4(item.address)).map(item => item.address)))];
}
function ensureTLS(directory, hosts) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const keyFile = join(directory, 'server-key.pem'); const certFile = join(directory, 'server-cert.pem');
  let regenerate = !existsSync(keyFile) || !existsSync(certFile);
  if (!regenerate) { const current = new X509Certificate(readFileSync(certFile)); regenerate = hosts.some(host => !current.checkIP(host)) || Date.parse(current.validTo) <= Date.now(); }
  if (regenerate) {
    const config = join(directory, 'certificate.cnf');
    writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Yasy Local Companion\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1' + hosts.filter(host => privateIPv4(host) && host !== '127.0.0.1').map(host => ',IP:' + host).join('') + '\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n', { mode: 0o600 });
    try { execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365', '-config', config, '-keyout', keyFile, '-out', certFile], { stdio: 'ignore', timeout: 20000 }); }
    catch { throw new AppError('无法生成本机手机连接证书，请检查 openssl 与数据目录权限。', 503); }
  }
  chmodSync(keyFile, 0o600); chmodSync(certFile, 0o600);
  const key = readFileSync(keyFile); const cert = readFileSync(certFile);
  const certificate = new X509Certificate(cert);
  assert(Date.parse(certificate.validTo) > Date.now(), '手机连接证书已过期，需重新生成并重新配对。', 503);
  return { key, cert, fingerprint: hash(certificate.raw) };
}
async function jsonBody(req) {
  assert((req.headers['content-type'] || '').startsWith('application/json'), '请使用 JSON 请求。', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; assert(size <= 4096, '配对请求过大。', 413); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks)); assert(data && typeof data === 'object' && !Array.isArray(data), '配对请求无效。'); return data; }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('配对 JSON 无效。'); }
}

export class MobileBridge {
  constructor({ dataDir, appFactory, port = 4319, bindHost = '0.0.0.0', addresses = mobileAddresses, clock = Date.now } = {}) {
    this.directory = join(dataDir, 'mobile'); this.appFactory = appFactory; this.requestedPort = port; this.bindHost = bindHost; this.addresses = addresses; this.clock = clock;
    this.server = null; this.starting = null; this.invite = null; this.tls = null; this.devices = [];
    const file = join(this.directory, 'devices.json');
    if (existsSync(file)) {
      try { const saved = JSON.parse(readFileSync(file, 'utf8')); assert(Array.isArray(saved) && saved.every(d => typeof d.id === 'string' && /^[a-f0-9]{64}$/.test(d.tokenHash) && Number.isFinite(Date.parse(d.expiresAt))), '设备记录无效。'); this.devices = saved; }
      catch { throw new AppError('手机配对记录无法读取，未开放手机连接。请检查本机备份。', 503); }
    }
  }
  get running() { return !!this.server?.listening; }
  saveDevices() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, 'devices.json'); const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.devices, null, 2), { mode: 0o600 }); chmodSync(temporary, 0o600); renameSync(temporary, file); chmodSync(file, 0o600);
  }
  refreshCode() {
    assert(this.running, '请先启用手机连接。', 409);
    this.invite = { code: String(randomInt(0, 1000000)).padStart(6, '0'), expires: this.clock() + 5 * 60 * 1000, attempts: 0 };
    return this.status();
  }
  status() {
    const port = this.running ? this.server.address().port : this.requestedPort;
    const hosts = this.addresses();
    const urls = hosts.map(host => `https://${host}:${port}`);
    const active = this.running && this.invite && this.invite.expires > this.clock() && this.invite.attempts < 5;
    return { available: true, running: this.running, port, urls, fingerprint: this.tls?.fingerprint || null,
      pairing: active ? { code: this.invite.code, expiresAt: new Date(this.invite.expires).toISOString(), links: urls.map(url => { const uri = new URL('yasy://pair'); uri.searchParams.set('url', url); uri.searchParams.set('fingerprint', this.tls.fingerprint); uri.searchParams.set('code', this.invite.code); return uri.href; }) } : null,
      devices: this.devices.map(({ tokenHash, ...device }) => device) };
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.running) return this.status();
    this.starting = (async () => {
      this.tls = ensureTLS(this.directory, this.addresses());
      const app = this.appFactory((req, url) => this.guard(req, url));
      const server = createServer({ key: this.tls.key, cert: this.tls.cert, minVersion: 'TLSv1.2' }, (req, res) => this.handle(req, res, app));
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.requestedPort, this.bindHost, () => { server.off('error', reject); resolve(); }); });
      this.server = server; server.on('error', () => {}); this.refreshCode(); return this.status();
    })();
    try { return await this.starting; }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('手机连接无法启动，请检查端口 4319 是否被占用。', 503); }
    finally { this.starting = null; }
  }
  async stop() {
    if (this.starting) await this.starting.catch(() => {});
    const server = this.server; this.invite = null; this.server = null;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    return this.status();
  }
  revoke(id) {
    assert(this.devices.some(device => device.id === id), '配对设备不存在。', 404);
    this.devices = this.devices.filter(device => device.id !== id); this.saveDevices(); return this.status();
  }
  validHost(host) {
    const port = this.server?.address()?.port;
    return ['127.0.0.1', 'localhost', ...this.addresses()].some(address => host === `${address}:${port}`);
  }
  origin(req) {
    assert(this.validHost(req.headers.host), '手机连接地址无效。', 403);
    const expected = `https://${req.headers.host}`;
    assert(!req.headers.origin || req.headers.origin === expected, '拒绝其他网站发起的手机请求。', 403);
    return expected;
  }
  authenticate(req) {
    const authorization = req.headers.authorization;
    const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const cookies = String(req.headers.cookie || '').split(';').map(part => part.trim());
    const token = bearer || cookies.find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
    assert(/^[A-Za-z0-9_-]{43}$/.test(token), '手机尚未配对或凭据已失效，请重新配对。', 401);
    const candidate = Buffer.from(hash(token), 'hex');
    const device = this.devices.find(item => timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), candidate) && Date.parse(item.expiresAt) > this.clock());
    assert(device, '手机配对已撤销或过期，请重新配对。', 401);
    return { device, bearer: !!bearer, token };
  }
  guard(req) {
    assert(isLocalPeer(req.socket.remoteAddress), '仅允许本地网络设备连接。', 403);
    const origin = this.origin(req); const session = this.authenticate(req);
    assert(req.method !== 'OPTIONS', '不接受跨站请求。', 403);
    if (!['GET', 'HEAD'].includes(req.method) && !session.bearer) assert(req.headers.origin === origin, '修改学习数据需要同源手机页面。', 403);
    req.yasyClient = 'ios'; req.yasyDevice = session.device.id;
    return session;
  }
  async handle(req, res, app) {
    const reply = (status, payload, cookie) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(JSON.stringify(payload)); };
    const sessionCookie = (token, expiresAt) => `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}`;
    try {
      assert(isLocalPeer(req.socket.remoteAddress), '仅允许本地网络设备连接。', 403);
      const url = new URL(req.url, 'https://localhost'); this.origin(req);
      if (url.pathname === '/api/mobile/pair' && req.method === 'POST') {
        const invite = this.invite;
        assert(invite && invite.expires > this.clock(), '配对码已过期或已使用，请在 Mac 刷新。', 410);
        assert(invite.attempts < 5, '配对尝试过多，请在 Mac 刷新配对码。', 429);
        const input = await jsonBody(req);
        assert(this.invite === invite && invite.expires > this.clock(), '配对码已过期或已使用，请在 Mac 刷新。', 410);
        assert(invite.attempts < 5, '配对尝试过多，请在 Mac 刷新配对码。', 429);
        invite.attempts++;
        assert(typeof input.code === 'string' && /^\d{6}$/.test(input.code) && timingSafeEqual(Buffer.from(input.code), Buffer.from(invite.code)), '配对码不正确。', 401);
        assert(typeof input.deviceName === 'string' && input.deviceName.trim().length > 0 && input.deviceName.length <= 80, '设备名称应为 1–80 字。');
        const token = randomBytes(32).toString('base64url'); const createdAt = new Date(this.clock()).toISOString(); const expiresAt = new Date(this.clock() + 30 * 86400000).toISOString();
        const device = { id: `device_${randomBytes(12).toString('hex')}`, name: input.deviceName.trim(), createdAt, expiresAt, tokenHash: hash(token) };
        this.devices.push(device); this.saveDevices(); this.invite = null;
        reply(200, { token, deviceId: device.id, expiresAt }, sessionCookie(token, expiresAt)); return;
      }
      if (url.pathname === '/api/mobile/session' && req.method === 'GET') {
        const session = this.guard(req); reply(200, { ok: true, deviceId: session.device.id, expiresAt: session.device.expiresAt }, sessionCookie(session.token, session.device.expiresAt)); return;
      }
      await app(req, res);
    } catch (error) { reply(error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.message : '手机连接请求失败，学习数据已保留。' }); }
  }
}
