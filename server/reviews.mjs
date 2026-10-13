import { assert, now, uid } from './domain.mjs';

export const reviewIntervals = [1,3,7,14,30,60,90];
export function getReviewQueue(store,kind,at=new Date()) {
  assert(['speaking','writing','words'].includes(kind),'请选择口语、写作或单词复习。');
  const reviews=store.all('review_states');
  const answers=store.all('answers');
  const words=store.all('words');
  const items=(kind==='words' ? words.map(word=>({kind:'word',id:word.id,word})) : answers.map(answer=>({kind:'answer',id:answer.id,questionId:answer.questionId,answer,question:store.question(answer.questionId)})).filter(x=>kind==='speaking' ? x.question.scope==='speaking' : x.question.scope!=='speaking')).map(item=>{
    const state=reviews.find(r=>r.kind===item.kind && r.targetId===item.id);
    // A rewritten answer is a new learning version and returns to the first review.
    const active=state && (item.kind==='word' || state.answerUpdatedAt===item.answer.updatedAt);
    return {...item,reviewCount:state?.reviewCount ?? 0,dueAt:active ? state.dueAt : item.answer?.updatedAt ?? item.word.createdAt};
  });
  const due=items.filter(x=>Date.parse(x.dueAt)<=at.getTime()).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt) || b.reviewCount-a.reviewCount || a.id.localeCompare(b.id));
  const future=items.filter(x=>Date.parse(x.dueAt)>at.getTime()).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt));
  return {item:due[0] ?? null,remaining:due.length,dueCount:due.length,total:items.length,...(future[0] ? {nextDueAt:future[0].dueAt} : {}),intervalDays:reviewIntervals};
}
export function recordReview(store,kind,id,at=new Date()) {
  assert(['answer','word'].includes(kind),'未知背诵对象。');
  const target=store.get(kind==='answer' ? 'answers' : 'words',id);
  assert(target,'背诵内容不存在。',404);
  return store.transaction(()=>{
    const key=`${kind}:${id}`;
    const old=store.get('review_states',key);
    const active=old && (kind==='word' || old.answerUpdatedAt===target.updatedAt);
    const reviewCount=(old?.reviewCount ?? 0)+1;
    const stageCount=(active ? old.stageCount ?? old.reviewCount : 0)+1;
    const totalCount=reviewCount;
    const intervalDays=reviewIntervals[Math.min(stageCount-1,reviewIntervals.length-1)];
    const dueAt=new Date(at.getTime()+intervalDays*86400000).toISOString();
    const item={id:key,kind,targetId:id,reviewCount,stageCount,totalCount,lastReviewedAt:at.toISOString(),dueAt,intervalDays,...(kind==='answer' ? {answerUpdatedAt:target.updatedAt} : {})};
    store.insert('review_states',item);
    store.insert('review_events',{id:uid('review'),kind,targetId:id,reviewedAt:at.toISOString(),dueAt,reviewCount});
    return item;
  });
}
