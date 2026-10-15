// An open Mac tab must not autosave old drafts over progress restored elsewhere.
export function installDatasetGuard() {
  const original = window.fetch.bind(window);
  let epoch: string | null = null;
  let replacing = false;
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return original(input, options);
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    if (epoch && !['GET', 'HEAD'].includes(method)) headers.set('X-Yasy-Dataset', epoch);
    const response = await original(input, { ...options, headers });
    const next = response.headers.get('X-Yasy-Dataset');
    if (next && epoch && next !== epoch && !replacing) {
      replacing = true;
      // Keep the old epoch until unload so pending pagehide saves are rejected.
      window.setTimeout(() => window.location.reload(), 0);
    } else if (next && !epoch) epoch = next;
    return response;
  };
}
