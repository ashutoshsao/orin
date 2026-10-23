// One API process owns live sessions. Serialize publish/unpublish even when there
// is no live sandbox; hold the lock until the remote operation and DB save finish.
const busy = new Set<string>();
export function acquireDeployment(id: string): (() => void) | null {
  if (busy.has(id)) return null;
  busy.add(id);
  return () => { busy.delete(id); };
}
