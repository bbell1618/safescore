export function isPublicEvidencePagePath(path: string): boolean {
  return /^\/evidence\/[^/]+$/.test(path);
}

export function isPublicRosterPagePath(path: string): boolean {
  return /^\/roster\/[^/]+$/.test(path);
}

export function isPublicPlanPagePath(path: string): boolean {
  return /^\/plan\/[^/]+\/?$/.test(path);
}

/** The carrier's no-password plan link actions. Each route validates the token itself. */
export function isPublicPlanApiPath(path: string): boolean {
  return (
    /^\/api\/plan\/[^/]+\/(sign|eld|roster|checkout)$/.test(path) ||
    /^\/api\/plan\/[^/]+\/requests\/[^/]+\/upload$/.test(path)
  );
}

export function isPublicUnauthenticatedPagePath(path: string): boolean {
  return (
    path === "/terms" ||
    isPublicPlanPagePath(path) ||
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
