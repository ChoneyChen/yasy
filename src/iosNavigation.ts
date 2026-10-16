import type { NativeView } from './nativeBridge';

export function createIOSRouteHistory<T extends { view: NativeView }>(fresh: (view: NativeView, current: T) => T) {
  const tabs = new Map<NativeView, T>();
  let settingsOrigin: T | undefined;
  return {
    select(current: T, next: NativeView): T {
      if (current.view !== next && current.view !== 'settings') tabs.set(current.view, current);
      if (next === 'settings') {
        if (current.view === 'settings') return current;
        settingsOrigin = current;
        return fresh('settings', current);
      }
      if (current.view === 'settings') settingsOrigin = undefined;
      if (current.view === next) { tabs.delete(next); return fresh(next, current); }
      return tabs.get(next) ?? fresh(next, current);
    },
    back(current: T): T {
      if (current.view === 'settings') {
        const origin = settingsOrigin; settingsOrigin = undefined;
        return origin ?? fresh('today', current);
      }
      return fresh(current.view, current);
    },
    settingsOrigin: () => settingsOrigin,
  };
}

export function nativeBackTicket(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const ticket = (value as { ticket?: unknown }).ticket;
  return Number.isSafeInteger(ticket) && Number(ticket) > 0 ? Number(ticket) : null;
}
