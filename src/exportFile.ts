import { nativeCall } from './mobileLocal/native';
type NativeExporter = { postMessage: (data: { filename: string; base64: string }) => void };
export async function exportBlob(blob: Blob, filename: string): Promise<'native' | 'browser'> {
  const appWindow = window as Window & { webkit?: { messageHandlers?: { yasyExport?: NativeExporter } } };
  const native = new URLSearchParams(window.location.search).get('client') === 'ios' && appWindow.webkit?.messageHandlers?.yasyExport;
  if (native) {
    if (blob.size > 50 * 1024 * 1024) throw new Error('手机导出文件上限为 50 MB，请拆分资料后导出。');
    const bytes = new Uint8Array(await blob.arrayBuffer()); const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    const payload = { filename, base64: btoa(chunks.join('')) };
    const bridge = (window as Window & { webkit?: { messageHandlers?: { yasyNative?: unknown } } }).webkit?.messageHandlers?.yasyNative;
    if (bridge) await nativeCall('file.export', payload);
    else native.postMessage(payload);
    return 'native';
  }
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'browser';
}
