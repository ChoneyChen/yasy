export interface VisibleViewport { left: number; top: number; width: number; height: number }
export interface MenuPosition { left: number; top: number; maxWidth: number; maxHeight: number }
const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), Math.max(min, max));

/** Coordinates are CSS pixels relative to the layout viewport. */
export function positionMenu(anchor: { x: number; y: number }, size: { width: number; height: number }, viewport: VisibleViewport, overlayBottomInset = 0, gap = 12): MenuPosition {
  const left = nonnegative(viewport.left); const top = nonnegative(viewport.top);
  const width = nonnegative(viewport.width); const height = nonnegative(viewport.height);
  const availableHeight = Math.max(0, height - Math.min(height, nonnegative(overlayBottomInset)));
  const horizontalGap = Math.min(nonnegative(gap), width / 2);
  const verticalGap = Math.min(nonnegative(gap), availableHeight / 2);
  const maxWidth = Math.max(0, width - horizontalGap * 2);
  const maxHeight = Math.max(0, availableHeight - verticalGap * 2);
  const menuWidth = Math.min(nonnegative(size.width), maxWidth);
  const menuHeight = Math.min(nonnegative(size.height), maxHeight);
  return {
    left: clamp(anchor.x, left + horizontalGap, left + width - horizontalGap - menuWidth),
    top: clamp(anchor.y, top + verticalGap, top + availableHeight - verticalGap - menuHeight),
    maxWidth, maxHeight,
  };
}

/** Fixed overlays need the visual viewport's occlusion; scrolling content does not. */
export function visualBottomOffset(layoutHeight: number, viewport: Pick<VisibleViewport, 'top' | 'height'>): number {
  return Math.max(0, nonnegative(layoutHeight) - nonnegative(viewport.top) - nonnegative(viewport.height));
}
