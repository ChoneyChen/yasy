export const nativeViews = ['today', 'recall', 'speaking', 'writing', 'words', 'settings'] as const;
export type NativeView = typeof nativeViews[number];
export type NativeRoute = { view: NativeView; ticket?: number };
export type NativeAppearance = { fontScale: number; reduceMotion: boolean; reduceTransparency: boolean; increaseContrast: boolean; boldText: boolean };
type NativeWindow = Window & {
  __YASY_NATIVE_APPEARANCE__?: unknown;
  webkit?: { messageHandlers?: { yasyNavigation?: { postMessage: (value: unknown) => void } } };
};

export function nativeRoute(value: unknown): NativeRoute | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!nativeViews.includes(item.view as NativeView)) return null;
  if (item.ticket !== undefined && (!Number.isSafeInteger(item.ticket) || Number(item.ticket) < 0)) return null;
  return { view: item.view as NativeView, ...(item.ticket === undefined ? {} : { ticket: item.ticket as number }) };
}

export function nativeAppearance(value: unknown): NativeAppearance {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    fontScale: typeof item.fontScale === 'number' && Number.isFinite(item.fontScale) ? Math.min(3.2, Math.max(.8, item.fontScale)) : 1,
    reduceMotion: item.reduceMotion === true, reduceTransparency: item.reduceTransparency === true,
    increaseContrast: item.increaseContrast === true, boldText: item.boldText === true,
  };
}

export function applyNativeAppearance(value: unknown) {
  const appearance = nativeAppearance(value);
  document.body.style.setProperty('--yasy-text-scale', String(appearance.fontScale));
  document.body.dataset.reduceMotion = String(appearance.reduceMotion);
  document.body.dataset.reduceTransparency = String(appearance.reduceTransparency);
  document.body.dataset.increaseContrast = String(appearance.increaseContrast);
  document.body.dataset.boldText = String(appearance.boldText);
}

export function initialNativeAppearance() { return (window as NativeWindow).__YASY_NATIVE_APPEARANCE__; }

export function postNativeNavigation(state: { view: NativeView; canGoBack: boolean; backgroundCount: number; title: string; ticket: number }): boolean {
  const bridge = (window as NativeWindow).webkit?.messageHandlers?.yasyNavigation;
  if (!bridge || new URLSearchParams(window.location.search).get('client') !== 'ios') return false;
  // Only navigation metadata crosses this bridge; draft and answer text remain in the learning API.
  bridge.postMessage({ view: state.view, canGoBack: state.canGoBack, backgroundCount: Math.max(0, Math.floor(state.backgroundCount)), title: state.title.slice(0, 40), ticket: state.ticket });
  return true;
}
