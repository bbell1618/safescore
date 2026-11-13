// QF-199: on the shared database the SafeScore buckets are prefixed (safescore-documents, ...) so they cannot
// collide with GoldenDesk's own. Stored rows keep the original names; names are mapped when a bucket is opened.
const PREFIX = (process.env.NEXT_PUBLIC_SAFESCORE_BUCKET_PREFIX ?? "").trim();

export function bucketName(name: string): string {
  if (!PREFIX || name.startsWith(PREFIX)) return name;
  return `${PREFIX}${name}`;
}
