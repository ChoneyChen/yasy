import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, LoaderCircle, RefreshCw, Smartphone, X } from 'lucide-react';
import QRCode from 'qrcode';

type Device = { id: string; name: string; createdAt: string; expiresAt: string };
type Status = { available: boolean; running: boolean; port: number; urls: string[]; fingerprint: string | null; pairing: { code: string; expiresAt: string; links: string[] } | null; devices: Device[] };
async function mobileRequest(path = 'status', method = 'GET'): Promise<Status> {
  const response = await fetch(`/api/mobile/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '手机连接操作失败。');
  return result;
}
export default function MobileSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [selectedURL, setSelectedURL] = useState('');
  const [qr, setQR] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const load = async () => { try { const next = await mobileRequest(); setStatus(next); setError(''); } catch (error) { setError(error instanceof Error ? error.message : '无法读取手机连接状态。'); } };
  useEffect(() => { let active = true; const refresh = async () => { try { const next = await mobileRequest(); if (active) setStatus(next); } catch {} }; load(); const timer = setInterval(refresh, 5000); return () => { active = false; clearInterval(timer); }; }, []);
  useEffect(() => { if (!status?.urls.includes(selectedURL)) setSelectedURL(status?.urls[0] || ''); }, [status?.urls.join('|'), selectedURL]);
  const pairingLink = status?.pairing?.links[status.urls.indexOf(selectedURL)] || '';
  useEffect(() => { let active = true; setQR(''); if (pairingLink) QRCode.toDataURL(pairingLink, { width: 240, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#1f4038', light: '#ffffff' } }).then(value => { if (active) setQR(value); }).catch(() => { if (active) setError('二维码生成失败，可复制配对链接。'); }); return () => { active = false; }; }, [pairingLink]);
  const change = async (action: string, method = 'POST') => { setBusy(action); setError(''); try { setStatus(await mobileRequest(action, method)); } catch (error) { setError(error instanceof Error ? error.message : '手机连接操作失败。'); } finally { setBusy(''); } };
  const copy = async () => { try { await navigator.clipboard.writeText(pairingLink); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError('无法自动复制，请从配对链接输入框手动复制。'); } };
  return <section className="card settings-card mobile-connection-card"><div className="section-heading"><div><h2>连接 iPhone</h2><p>可选局域网同步 · 两端各自独立保存</p></div><Smartphone size={23} /></div>{error && <p className="ai-inline-error" role="status">{error}</p>}{!status ? <p className="muted">正在读取连接状态…</p> : !status.running ? <><p>iPhone 平时独立使用，无需连接 Mac。只有需要手动同步进度时才启用此处连接；扫描二维码完成配对后，再到手机选择覆盖方向。配对本身不会改变任何进度。</p><button className="button primary" disabled={!!busy || !status.available} onClick={() => change('start')}>{busy === 'start' ? <LoaderCircle size={16} className="spin" /> : <Smartphone size={16} />}启用同步连接</button>{!status.available && <p className="muted">请用 npm start 启动完整的 Mac 服务。</p>}</> : <><div className="mobile-connection-status"><span className="pill green"><CheckCircle2 size={13} />同步连接已启用</span><button className="text-button" disabled={!!busy} onClick={() => change('stop')}><X size={15} />关闭同步连接</button></div>{status.urls.length > 0 ? <><label className="form-label"><span>Mac 的连接地址</span><select value={selectedURL} onChange={event => setSelectedURL(event.target.value)}>{status.urls.map(url => <option key={url} value={url}>{url}</option>)}</select></label>{status.pairing && pairingLink ? <div className="mobile-pairing-content">{qr && <img className="mobile-pairing-qr" src={qr} alt="用 Yasy iPhone App 扫描的配对二维码" />}<div><h3>在 iPhone 同步页扫描配对</h3><p>配对码 <strong className="mobile-pairing-code">{status.pairing.code}</strong></p><p className="muted">{new Date(status.pairing.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 前有效，成功后失效。</p><button className="button secondary small-button" onClick={copy}>{copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}{copied ? '已复制' : '复制配对链接'}</button></div><input className="mobile-pairing-link" readOnly value={pairingLink} aria-label="iPhone 配对链接" /></div> : <p>配对码已使用或过期。已配对手机仍可手动同步；新增设备请生成新配对码。</p>}</> : <p>尚未找到可用的局域网地址。请让 Mac 与 iPhone 接入同一个 Wi-Fi，再刷新。</p>}<button className="text-button" disabled={!!busy} onClick={() => change('pairing-code')}><RefreshCw size={15} />生成新配对码</button></>}{status && status.devices.length > 0 && <div className="mobile-paired-devices"><h3>已配对设备</h3>{status.devices.map(device => <div key={device.id}><span><Smartphone size={16} />{device.name}</span><button className="text-button" disabled={!!busy} onClick={() => change(`devices/${encodeURIComponent(device.id)}`, 'DELETE')}>撤销配对</button></div>)}</div>}<p className="settings-explanation">手机题库、草稿、答案、素材语料、单词与复习记录保存在 iPhone，本机 Keychain 单独保存手机 API 配置。需要同步时，由用户明确选择 iPhone → Mac 或 Mac → iPhone；接收端先留备份，再完整覆盖，不自动合并。API 密钥和 PDF/DOC/DOCX 原件不随学习备份同步。仅同步时要求 Mac 服务在线；关闭连接不影响手机独立学习。配对使用 HTTPS 与证书指纹。</p></section>;
}
