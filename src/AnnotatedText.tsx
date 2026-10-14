import { useMemo } from 'react';
import { isApprovedExpression } from './backgroundJobs.mjs';
import type { Answer, Expression, Material, Scope } from './types';

export function AnnotatedText({ text, answer, materials = [], expressions = [], scope, questionId, onMaterial, onExpression }: { text: string; answer?: Answer; materials?: Material[]; expressions?: Expression[]; scope: Scope; questionId?: string; onMaterial?: (material: Material) => void; onExpression?: (expression: Expression) => void }) {
  const segments = useMemo(() => {
    const ranges: { start: number; end: number; material?: Material; expression?: Expression; color?: number }[] = [];
    for (const span of answer?.materialSpans || []) {
      const material = materials.find(item => item.id === span.materialId);
      if (material && span.start >= 0 && span.end <= text.length && span.start < span.end) ranges.push({ start: span.start, end: span.end, material, color: Math.max(0, answer!.materialIds.indexOf(material.id)) % 3 });
    }
    for (const expression of expressions) {
      if (!isApprovedExpression(expression) || !expression.textEn) continue;
      const escaped = expression.textEn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      for (const match of text.matchAll(regex)) {
        if (match.index === undefined) continue;
        const before = text[match.index - 1] || '';
        const after = text[match.index + match[0].length] || '';
        if (/\p{L}/u.test(expression.textEn[0]) && /\p{L}/u.test(before)) continue;
        if (/\p{L}/u.test(expression.textEn.at(-1) || '') && /\p{L}/u.test(after)) continue;
        ranges.push({ start: match.index, end: match.index + match[0].length, expression });
      }
    }
    const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1];
      const active = ranges.filter(range => range.start <= start && range.end >= end);
      return { start, end, material: active.find(range => range.material)?.material, color: active.find(range => range.material)?.color, expression: active.find(range => range.expression)?.expression };
    });
  }, [text, answer, materials, expressions]);
  return <span data-word-scope={scope} data-word-question={questionId}>{segments.map(segment => {
    const content = text.slice(segment.start, segment.end);
    if (!segment.material && !segment.expression) return content;
    const clickable = segment.expression ? !!onExpression : !!onMaterial;
    const activate = () => { if (segment.expression) onExpression?.(segment.expression); else if (segment.material) onMaterial?.(segment.material); };
    return <span key={segment.start} className={`annotated-fragment ${segment.material ? `material-highlight material-color-${segment.color}` : ''} ${segment.expression ? 'expression-underline' : ''} ${clickable ? 'annotation-clickable' : ''}`} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined} title={segment.expression ? `${segment.expression.textEn} · Click for usage` : 'Click to read the original material'} onClick={event => { if (clickable) event.stopPropagation(); activate(); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); activate(); } }}>{content}</span>;
  })}</span>;
}
