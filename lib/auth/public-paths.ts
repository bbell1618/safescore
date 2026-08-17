export function isPublicEvidencePagePath(path: string): boolean {
  return /^\/evidence\/[^/]+$/.test(path);
}

export function isPublicRosterPagePath(path: string): boolean {
  return /^\/roster\/[^/]+$/.test(path);
}

export function isPublicUnauthenticatedPagePath(path: string): boolean {
  return (
    path === "/terms" ||
    path === "/terms/" ||
    isPublicEvidencePagePath(path) ||
    isPublicRosterPagePath(path)
  );
}

export function isPublicEvidenceUploadPath(path: string): boolean {
  return /^\/api\/evidence\/[^/]+\/upload$/.test(path);
}

export function isPublicRosterApiPath(path: string): boolean {
  return (
    /^\/api\/roster\/[^/]+$/.test(path) ||
    /^\/api\/roster\/[^/]+\/drivers$/.test(path) ||
    /^\/api\/roster\/[^/]+\/drivers\/[^/]+$/.test(path) ||
    /^\/api\/roster\/[^/]+\/drivers\/[^/]+\/documents$/.test(path) ||
    /^\/api\/roster\/[^/]+\/submit$/.test(path)
  );
}
