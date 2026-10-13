export interface SnapshotTicket { readonly epoch: number; readonly sequence: number }
export interface SnapshotGate {
  begin(): SnapshotTicket;
  invalidate(): void;
  apply(ticket: SnapshotTicket, commit: () => void): boolean;
}
export function createSnapshotGate(): SnapshotGate;
