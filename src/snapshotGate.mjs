// A GET started before a write or navigation must not replace that newer view.
// Reading a snapshot has no side effects until its ticket is accepted.
export function createSnapshotGate() {
  let epoch = 0;
  let latestRead = 0;
  return {
    begin() { return Object.freeze({ epoch, sequence: ++latestRead }); },
    invalidate() { epoch++; latestRead++; },
    apply(ticket, commit) {
      if (ticket.epoch !== epoch || ticket.sequence !== latestRead) return false;
      commit();
      return true;
    },
  };
}
