type BoundsInput = { layoutWidth: number; layoutHeight: number; width?: number; height?: number; top?: number; left?: number };
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

export function iosVisibleBounds(input: BoundsInput) {
  const layoutWidth = Math.max(1, input.layoutWidth), layoutHeight = Math.max(1, input.layoutHeight);
  const width = bounded(input.width, layoutWidth, 1, layoutWidth), height = bounded(input.height, layoutHeight, 1, layoutHeight);
  // WebKit can retain an obsolete offset briefly after dismissing the keyboard.
  // A visible viewport can never extend beyond its layout viewport.
  return { width, height, top: bounded(input.top, 0, 0, layoutHeight - height), left: bounded(input.left, 0, 0, layoutWidth - width) };
}

export function installIOSViewport() {
  let scheduled = 0;
  let previous = '';
  const update = () => {
    scheduled = 0;
    const viewport = window.visualViewport;
    const bounds = iosVisibleBounds({ layoutWidth: window.innerWidth, layoutHeight: window.innerHeight,
      width: viewport?.width, height: viewport?.height, top: viewport?.offsetTop, left: viewport?.offsetLeft });
    const signature = JSON.stringify(bounds);
    if (signature === previous) return;
    previous = signature;
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(bounds)) style.setProperty(`--ios-visible-${key}`, `${value}px`);
    // These bounds constrain fixed sheets only. Never resize or scroll the editor.
    window.dispatchEvent(new CustomEvent('yasy:viewport', { detail: bounds }));
  };
  const schedule = () => { if (!scheduled) scheduled = window.requestAnimationFrame(update); };
  update();
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  return () => {
    if (scheduled) window.cancelAnimationFrame(scheduled);
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  };
}
