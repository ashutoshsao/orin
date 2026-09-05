// How many bundles each project keeps in R2 (7.1). Every bundle is FULL (all history from
// HEAD), so the newest alone restores any kept rewind point; the second is a spare in case
// the newest turns out unreadable.
export const KEEP_BUNDLES = 2;

export type StoredObject = { key: string; lastModified?: Date | string };

// Which of a project's bundle objects to delete: everything except the current
// `latestKey` (always kept, whatever its timestamp) and the newest others up to `keep`.
// Pure so it's testable without R2; the worker lists, calls this, deletes.
export function bundlesToDelete(objects: StoredObject[], latestKey: string, keep = KEEP_BUNDLES): string[] {
  const time = (o: StoredObject) => (o.lastModified ? new Date(o.lastModified).getTime() : 0);
  const others = objects.filter((o) => o.key !== latestKey).sort((a, b) => time(b) - time(a));
  const hasLatest = objects.length !== others.length;
  const spare = Math.max(0, keep - (hasLatest ? 1 : 0));
  return others.slice(spare).map((o) => o.key);
}
