import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent, type TouchEvent } from 'react';
import { BookPlus, X } from 'lucide-react';
import type { Scope } from './types';
import { positionMenu, visualBottomOffset, type MenuPosition, type VisibleViewport } from './menuPosition';

type MenuWord = { textEn: string; scope: Scope; questionId?: string; x: number; y: number };
type WordInput = { textEn: string; meaningZh: string; exampleEn: string; scope: Scope; questionId?: string };
function viewportBounds(): VisibleViewport { const viewport = window.visualViewport; return { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0, width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight }; }
function overlayBottomInset() { const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ios-overlay-bottom-inset')); return Number.isFinite(value) ? Math.max(0, value) : 0; }
export function installNativeWordMenuBack(hasMenu: () => boolean, close: () => void) {
  if (new URLSearchParams(window.location.search).get('client') !== 'ios') return () => {};
  const dismiss = (event: Event) => {
    if (!hasMenu()) return;
    // Vocabulary popovers sit above content sheets. Capture the shared dismiss
    // event before a sheet consumes it, so one native Back closes one layer.
    event.preventDefault(); event.stopImmediatePropagation(); close();
  };
  window.addEventListener('yasy:dismiss-sheet', dismiss, true);
  return () => window.removeEventListener('yasy:dismiss-sheet', dismiss, true);
}
function wordAtPoint(x: number, y: number) {
  const reader = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const position = reader.caretPositionFromPoint?.(x, y);
  const range = position ? null : reader.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode || range?.startContainer;
  const offset = position?.offset ?? range?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE) return '';
  const text = node.textContent || '';
  let start = offset; let end = offset;
  while (start > 0 && /[\p{Script=Latin}\p{M}’'-]/u.test(text[start - 1])) start--;
  while (end < text.length && /[\p{Script=Latin}\p{M}’'-]/u.test(text[end])) end++;
  return text.slice(start, end).replace(/^['’\-]+|['’\-]+$/g, '');
}
export function EnglishContext({ children, addWord }: { children: ReactNode; addWord: (word: WordInput) => void }) {
  const [menu, setMenu] = useState<MenuWord | null>(null);
  const currentMenu = useRef(menu); currentMenu.current = menu;
  const [placement, setPlacement] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const closeMenu = () => { currentMenu.current = null; setMenu(null); setPlacement(null); };
  const openMenu = (target: EventTarget | null, x: number, y: number) => {
    const element = target instanceof Element ? target : null;
    const context = element?.closest<HTMLElement>('[data-word-scope]');
    if (!context) return false;
    const selection = window.getSelection();
    const selected = selection?.toString().trim() || '';
    const selectedInside = selection?.anchorNode && context.contains(selection.anchorNode);
    const textEn = selectedInside && /^[\p{Script=Latin}][\p{Script=Latin}\p{M}\s’'.,;:!?()-]*$/u.test(selected) && selected.length <= 160 ? selected : wordAtPoint(x, y);
    if (!textEn || !/\p{Script=Latin}/u.test(textEn)) return false;
    setPlacement(null);
    const next = { textEn, scope: context.dataset.wordScope as Scope, questionId: context.dataset.wordQuestion, x, y };
    currentMenu.current = next; setMenu(next);
    return true;
  };
  const contextMenu = (event: MouseEvent) => { if (openMenu(event.target, event.clientX, event.clientY)) event.preventDefault(); };
  const cancelTouch = () => { if (touchTimer.current) clearTimeout(touchTimer.current); touchTimer.current = null; };
  const touchStart = (event: TouchEvent) => { cancelTouch(); longPressed.current = false; const touch = event.touches[0]; if (event.touches.length !== 1 || !touch || !(event.target instanceof Element) || !event.target.closest('[data-word-scope]')) return; const target = event.target; touchTimer.current = setTimeout(() => { longPressed.current = openMenu(target, touch.clientX, touch.clientY); }, 600); };
  const touchEnd = (event: TouchEvent) => { cancelTouch(); if (longPressed.current && event.cancelable) event.preventDefault(); };
  useEffect(() => {
    const dismiss = () => { closeMenu(); longPressed.current = false; cancelTouch(); };
    const removeNativeBack = installNativeWordMenuBack(() => currentMenu.current !== null, dismiss);
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', close);
    window.addEventListener('yasy:navigate', dismiss);
    window.addEventListener('yasy:background-tasks', dismiss);
    return () => { removeNativeBack(); document.removeEventListener('keydown', close); window.removeEventListener('yasy:navigate', dismiss); window.removeEventListener('yasy:background-tasks', dismiss); cancelTouch(); };
  }, []);

  // This variable is only consumed by fixed overlays such as Toast; document
  // content continues using the native scroll view's automatic safe-area inset.
  useLayoutEffect(() => {
    const update = () => document.documentElement.style.setProperty('--ios-visual-bottom-offset', `${visualBottomOffset(window.innerHeight, viewportBounds())}px`);
    update(); window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update);
    return () => { window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); document.documentElement.style.removeProperty('--ios-visual-bottom-offset'); };
  }, []);
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const measure = () => {
      if (!element.isConnected || menuRef.current !== element) return;
      const viewport = viewportBounds(); const bottom = overlayBottomInset();
      const limits = positionMenu(menu, { width: 0, height: 0 }, viewport, bottom);
      // Apply current viewport constraints before measuring, so a rotation or
      // text-size change cannot retain the previous viewport's narrower width.
      element.style.maxWidth = `${limits.maxWidth}px`; element.style.maxHeight = `${limits.maxHeight}px`;
      const rect = element.getBoundingClientRect();
      const next = positionMenu(menu, { width: rect.width, height: rect.height }, viewport, bottom);
      setPlacement(previous => previous && previous.left === next.left && previous.top === next.top && previous.maxWidth === next.maxWidth && previous.maxHeight === next.maxHeight ? previous : next);
    };
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure); resize?.observe(element);
    const changes = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    changes?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    changes?.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-bold-text', 'data-increase-contrast'] });
    window.addEventListener('resize', measure); window.addEventListener('yasy:overlay-inset', measure);
    window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => { resize?.disconnect(); changes?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('yasy:overlay-inset', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, [menu]);

  return <div className="english-context" onContextMenu={contextMenu} onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={cancelTouch} onTouchMove={cancelTouch} onClickCapture={event => { if (longPressed.current && event.detail !== 0) { longPressed.current = false; event.preventDefault(); event.stopPropagation(); } }}>{children}{menu && <><button className="word-menu-backdrop" aria-label="关闭单词菜单" onClick={closeMenu} /><div ref={menuRef} className="word-context-menu" style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, maxWidth: placement?.maxWidth, maxHeight: placement?.maxHeight, overflowY: 'auto', overscrollBehavior: 'contain', visibility: placement ? 'visible' : 'hidden' }} role="menu"><div><strong>{menu.textEn}</strong><button className="icon-button" aria-label="关闭" onClick={closeMenu}><X size={14} /></button></div><button className="word-menu-add" role="menuitem" onClick={() => { addWord({ textEn: menu.textEn, meaningZh: '', exampleEn: '', scope: menu.scope, questionId: menu.questionId }); closeMenu(); }}><BookPlus size={17} />收藏到单词本</button><small>支持选中短语 · 手机长按</small></div></>}</div>;
}
