import { Children, Fragment, cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function isNativeIOS() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('client') === 'ios';
}

type ChildProps = { children?: ReactNode; className?: string };
function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child => isValidElement<ChildProps>(child) && child.type === Fragment ? flatten(child.props.children) : [child]);
}
function contentParts(children: ReactNode) {
  const body: ReactNode[] = []; const actions: ReactNode[] = [];
  for (const child of flatten(children)) {
    if (isValidElement<ChildProps>(child) && child.props.className?.split(/\s+/).includes('modal-actions')) actions.push(child);
    else body.push(child);
  }
  return { body, actions };
}

const sheetStack: string[] = [];
let originalOverflow = '';

const editable = (element: HTMLElement) => element.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || element.isContentEditable;
const visible = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0 && !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.ownerDocument.defaultView?.getComputedStyle(element).visibility !== 'hidden';
const enabled = (element: HTMLElement) => !element.matches(':disabled,[aria-disabled="true"],input[type="hidden"]');

/** Keep hardware-keyboard and programmatic focus inside the top sheet. */
export function manageSheetFocus(sheet: HTMLElement, isTop: () => boolean, previous: Element | null) {
  const document = sheet.ownerDocument;
  const focus = (element: HTMLElement | null) => { if (element && visible(element) && enabled(element)) element.focus({ preventScroll: true }); };
  const targets = () => [...sheet.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,summary,[tabindex],[contenteditable]')].filter(element => element.tabIndex >= 0 && visible(element) && enabled(element));
  const initial = () => sheet.querySelector<HTMLElement>('button[aria-label="关闭"]') || sheet;
  const focusInside = () => focus(initial());
  // React's autoFocus has already run by this point; retain it for word forms.
  if (isTop() && !sheet.contains(document.activeElement)) {
    const autofocus = sheet.querySelector<HTMLElement>('[autofocus]');
    focus(autofocus && visible(autofocus) && enabled(autofocus) ? autofocus : initial());
  }
  const keydown = (event: KeyboardEvent) => {
    if (!isTop() || event.key !== 'Tab') return;
    const items = targets(); const active = document.activeElement;
    if (!items.length) { event.preventDefault(); focus(sheet); return; }
    if (!sheet.contains(active) || active === sheet || (event.shiftKey ? active === items[0] : active === items.at(-1))) {
      event.preventDefault(); focus(event.shiftKey ? items.at(-1)! : items[0]);
    }
  };
  let redirecting = false;
  const focusin = (event: FocusEvent) => {
    if (!isTop() || sheet.contains(event.target as Node) || redirecting) return;
    redirecting = true; focusInside(); redirecting = false;
  };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', focusin, true);
  return (restore = true) => {
    document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin, true);
    if (!restore || !(previous instanceof HTMLElement)) return;
    // Re-focusing an old editor would reopen its keyboard. A parent dialog is
    // a safe return point when closing a nested sheet over an editable field.
    focus(editable(previous) ? previous.closest<HTMLElement>('[role="dialog"]') : previous);
  };
}

/** Native content sheet: the header and actions never share the body's scroll. */
export function IOSSheet({ title, children, close, footer, wide = false, className = '' }: { title: string; children: ReactNode; close: () => void; footer?: ReactNode; wide?: boolean; className?: string }) {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const previousFocus = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input,textarea,[contenteditable="true"]') && !sheetRef.current?.contains(active)) active.blur();
    if (!sheetStack.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    sheetStack.push(titleId);
    const releaseFocus = sheetRef.current ? manageSheetFocus(sheetRef.current, () => sheetStack.at(-1) === titleId, previousFocus.current) : undefined;
    const dismiss = (event: Event) => { if (sheetStack.at(-1) !== titleId) return; event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(event); };
    document.addEventListener('keydown', escape);
    window.addEventListener('yasy:dismiss-sheet', dismiss);
    return () => { document.removeEventListener('keydown', escape); window.removeEventListener('yasy:dismiss-sheet', dismiss); const wasTop = sheetStack.at(-1) === titleId; const index = sheetStack.indexOf(titleId); if (index >= 0) sheetStack.splice(index, 1); releaseFocus?.(wasTop); if (!sheetStack.length) document.body.style.overflow = originalOverflow; };
  }, [titleId]);
  const nodes = flatten(children);
  const form = nodes.length === 1 && isValidElement<ChildProps>(nodes[0]) && nodes[0].type === 'form' ? nodes[0] as ReactElement<ChildProps> : null;
  const parts = contentParts(form ? form.props.children : children);
  const actions = footer ?? (parts.actions.length ? parts.actions : <button type="button" className="button secondary" onClick={close}>完成</button>);
  const regions = <><div className="ios-sheet-body" role="region" aria-label={`${title}内容`} tabIndex={0}>{parts.body}</div><footer className="ios-sheet-footer">{actions}</footer></>;
  return <div className="modal-overlay ios-sheet-overlay" onClick={close}><section ref={sheetRef} className={`modal ios-sheet ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={event => event.stopPropagation()}><header className="ios-sheet-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="关闭" onClick={close}><X size={20} /></button></header>{form ? cloneElement(form, { className: `${form.props.className || ''} ios-sheet-form` }, regions) : <div className="ios-sheet-content">{regions}</div>}</section></div>;
}
