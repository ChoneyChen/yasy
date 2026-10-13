import { useEffect, useRef, useState, type ReactNode, type MouseEvent, type TouchEvent } from 'react';
import { BookPlus, X } from 'lucide-react';
import type { Scope } from './types';

type MenuWord = { textEn: string; scope: Scope; questionId?: string; x: number; y: number };
type WordInput = { textEn: string; meaningZh: string; exampleEn: string; scope: Scope; questionId?: string };
function wordAtPoint(x: number, y: number) {
  const reader = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const position = reader.caretPositionFromPoint?.(x, y);
  const range = position ? null : reader.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode || range?.startContainer;
  const offset = position?.offset ?? range?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE) return '';
  const text = node.textContent || '';
  let start = offset;
  let end = offset;
  while (start > 0 && /[\p{Script=Latin}\p{M}’'-]/u.test(text[start - 1])) start--;
  while (end < text.length && /[\p{Script=Latin}\p{M}’'-]/u.test(text[end])) end++;
  return text.slice(start, end).replace(/^['’\-]+|['’\-]+$/g, '');
}
export function EnglishContext({ children, addWord }: { children: ReactNode; addWord: (word: WordInput) => void }) {
  const [menu, setMenu] = useState<MenuWord | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openMenu = (target: EventTarget | null, x: number, y: number) => {
    const element = target instanceof Element ? target : null;
    const context = element?.closest<HTMLElement>('[data-word-scope]');
    if (!context) return false;
    const selection = window.getSelection();
    const selected = selection?.toString().trim() || '';
    const selectedInside = selection?.anchorNode && context.contains(selection.anchorNode);
    const textEn = selectedInside && /^[\p{Script=Latin}][\p{Script=Latin}\p{M}\s’'.,;:!?()-]*$/u.test(selected) && selected.length <= 160 ? selected : wordAtPoint(x, y);
    if (!textEn || !/\p{Script=Latin}/u.test(textEn)) return false;
    setMenu({ textEn, scope: context.dataset.wordScope as Scope, questionId: context.dataset.wordQuestion, x: Math.min(x, window.innerWidth - 245), y: Math.min(y, window.innerHeight - 125) });
    return true;
  };
  const contextMenu = (event: MouseEvent) => { if (openMenu(event.target, event.clientX, event.clientY)) event.preventDefault(); };
  const cancelTouch = () => { if (touchTimer.current) clearTimeout(touchTimer.current); touchTimer.current = null; };
  const touchStart = (event: TouchEvent) => { cancelTouch(); const touch = event.touches[0]; if (!touch || !(event.target instanceof Element) || !event.target.closest('[data-word-scope]')) return; const target = event.target; touchTimer.current = setTimeout(() => openMenu(target, touch.clientX, touch.clientY), 600); };
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); }; document.addEventListener('keydown', close); return () => { document.removeEventListener('keydown', close); cancelTouch(); }; }, []);
  return <div className="english-context" onContextMenu={contextMenu} onTouchStart={touchStart} onTouchEnd={cancelTouch} onTouchMove={cancelTouch}>{children}{menu && <><button className="word-menu-backdrop" aria-label="关闭单词菜单" onClick={() => setMenu(null)} /><div className="word-context-menu" style={{ left: Math.max(12, menu.x), top: Math.max(12, menu.y) }} role="menu"><div><strong>{menu.textEn}</strong><button className="icon-button" aria-label="关闭" onClick={() => setMenu(null)}><X size={14} /></button></div><button className="word-menu-add" role="menuitem" onClick={() => { addWord({ textEn: menu.textEn, meaningZh: '', exampleEn: '', scope: menu.scope, questionId: menu.questionId }); setMenu(null); }}><BookPlus size={17} />收藏到单词本</button><small>支持选中短语 · 手机长按</small></div></>}</div>;
}
