import { nativeCall } from './native';
import { createLocalStore } from './store.mjs';
import { createLocalRouter } from './router.mjs';
import { exportBlob } from '../exportFile';
export async function installMobileBackend(beforeSync: () => Promise<void>) {
  const runtime = await createLocalStore({ load: () => nativeCall('storage.read'), save: (value: unknown, restoring: boolean) => nativeCall(restoring ? 'storage.restore' : 'storage.write', { value }) });
  const route = await createLocalRouter({ runtime });
  const originalFetch = window.fetch.bind(window);
  let replacing = false;
  const frozenResponse = () => new Response(JSON.stringify({ error: '正在覆盖学习进度，请等待完成后继续。' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, options = {}) => {
    const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(address, window.location.href);
    if (url.host === 'app' && url.protocol === 'yasy-local:' && url.pathname.startsWith('/api/')) {
      if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
      const request = input instanceof Request ? { method: input.method, body: ['GET', 'HEAD'].includes(input.method) ? undefined : await input.clone().text() } : {};
      const combined = { ...request, ...options };
      if (replacing && !['GET', 'HEAD'].includes((combined.method || 'GET').toUpperCase())) return frozenResponse();
      const restoring = url.pathname === '/api/backup' && combined.method?.toUpperCase() === 'POST';
      if (restoring) { await beforeSync(); if (replacing) return frozenResponse(); replacing = true; }
      const response = await route(url.href, combined);
      if (restoring) {
        if (response.ok) window.setTimeout(() => { void nativeCall('ui.reload'); }, 0);
        else replacing = false;
      }
      return response;
    }
    return originalFetch(input, options);
  };
  document.addEventListener('click', event => {
    const anchor = (event.target as Element | null)?.closest('a'); if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.protocol !== 'yasy-local:' || !/^\/api\/(?:sources|batches)\/[^/]+\/file$|^\/api\/backup(?:\/previous)?$/.test(url.pathname)) return;
    event.preventDefault();
    void route(url.href).then(async (response: Response) => {
      if (!response.ok) { const error = await response.json(); throw new Error(error.error); }
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = decodeURIComponent(disposition.split("filename*=UTF-8''")[1] || 'yasy-export.json');
      await exportBlob(await response.blob(), filename);
    }).catch(error => window.alert(error.message));
  }, true);
  window.addEventListener('yasy:sync', event => {
    const detail = (event as CustomEvent).detail;
    let didPull = false;
    let ownsFreeze = false;
    void (async () => {
      if (replacing) throw new Error('另一次进度覆盖仍在进行，请等待完成。');
      await beforeSync();
      if (replacing) throw new Error('另一次进度覆盖仍在进行，请等待完成。');
      replacing = true; ownsFreeze = true;
      const response = await route('/api/sync', { method: 'POST', body: JSON.stringify({ direction: detail?.direction, confirmed: detail?.confirmed === true, runId: detail?.runId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      didPull = detail.direction === 'pull';
      await nativeCall('sync.feedback', { message: result.message, runId: detail?.runId });
      if (didPull) await nativeCall('ui.reload');
      else replacing = false;
    })().catch(error => {
      if (ownsFreeze && !didPull) replacing = false;
      void nativeCall('sync.feedback', { message: error.message, error: true, runId: detail?.runId });
      if (didPull) void nativeCall('ui.reload');
    });
  });
}
