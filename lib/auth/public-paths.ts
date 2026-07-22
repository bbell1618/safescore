export function isPublicEvidencePagePath(path: string): boolean {
  return /^\/evidence\/[^/]+$/.test(path);
}

export function isPublicEvidenceUploadPath(path: string): boolean {
  return /^\/api\/evidence\/[^/]+\/upload$/.test(path);
}
