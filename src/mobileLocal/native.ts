type NativeReply = { result?: unknown; error?: { message?: string; status?: number } };
type BridgeWindow = Window & { __yasyNativeReply?: (id: string, value: NativeReply) => void; webkit?: { messageHandlers?: { yasyNative?: { postMessage: (value: unknown) => void } } } };
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (value: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let sequence = 0;
const documentID = crypto.getRandomValues(new Uint32Array(2)).join('-');
export function nativeCall<T = unknown>(action: string, body: unknown = {}): Promise<T> {
  const host = window as BridgeWindow;
  const bridge = host.webkit?.messageHandlers?.yasyNative;
  if (!bridge) return Promise.reject(new Error('iPhone 原生存储接口未就绪，请重新打开 Yasy。'));
  host.__yasyNativeReply = (id, value) => {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); clearTimeout(request.timer);
    if (value.error) request.reject(Object.assign(new Error(value.error.message || '手机本地操作失败。'), { status: value.error.status || 500 }));
    else request.resolve(value.result);
  };
  const id = `local-${documentID}-${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('手机操作超时，未自动重试。请检查任务状态。')); }, 240000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    try { bridge.postMessage({ id, action, body }); }
    catch { clearTimeout(timer); pending.delete(id); reject(new Error('无法访问手机原生接口。')); }
  });
}
