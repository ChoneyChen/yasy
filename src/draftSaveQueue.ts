// Serializes writes for one question while independent questions remain parallel.
// Failed requests release the queue; this never retries an AI or learning request.
export function createDraftSaveQueue() {
  const pending = new Map<string, Promise<void>>();
  const failures = new Map<string, unknown>();
  return {
    run<T>(id: string, write: () => Promise<T>): Promise<T> {
      const operation = (pending.get(id) || Promise.resolve()).then(write);
      const settled = operation.then(() => { failures.delete(id); }, error => { failures.set(id, error); });
      pending.set(id, settled);
      void settled.then(() => { if (pending.get(id) === settled) pending.delete(id); });
      return operation;
    },
    async drain() { await Promise.all([...pending.values()]); if (failures.size) throw new Error('仍有草稿未能保存，请先重试保存，再覆盖同步。'); },
  };
}
