type PendingDraft = { textZh: string; materialIds: string[] };
const copy = (draft: PendingDraft): PendingDraft => ({ textZh: draft.textZh, materialIds: [...draft.materialIds] });
export function createPendingDraftCache() {
  const drafts = new Map<string, PendingDraft>();
  return {
    read(id: string) { const value = drafts.get(id); return value ? copy(value) : undefined; },
    remember(id: string, draft: PendingDraft) { drafts.set(id, copy(draft)); },
    observeSnapshot(snapshots: (PendingDraft & { questionId: string })[]) {
      for (const snapshot of snapshots) {
        const current = drafts.get(snapshot.questionId);
        if (current?.textZh.trim() === snapshot.textZh && JSON.stringify(current.materialIds) === JSON.stringify(snapshot.materialIds)) drafts.delete(snapshot.questionId);
      }
    },
  };
}
