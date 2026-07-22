import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260722232131_harden_new_user_role_assignment.sql"
);
assert.match(migration, /'client_user'::public\.user_role/);
assert.doesNotMatch(migration, /raw_user_meta_data\s*->>\s*'role'/);
assert.doesNotMatch(migration, /EXCEPTION\s+WHEN\s+OTHERS/i);
assert.match(migration, /SET search_path = ''/);
assert.match(
  migration,
  /REVOKE EXECUTE ON FUNCTION public\.handle_new_user\(\)[\s\S]*FROM PUBLIC, anon, authenticated;/
);

const runtimeRoleReaders = [
  "app/(auth)/login/page.tsx",
  "app/(console)/console/layout.tsx",
  "app/api/analysis/import/route.ts",
];
for (const path of runtimeRoleReaders) {
  const source = read(path);
  assert.doesNotMatch(source, /user_metadata\??\.role/);
  assert.match(source, /\.from\("users"\)/);
  assert.match(source, /\.select\("role"\)/);
}

const setupRoute = read("app/api/auth/setup/route.ts");
for (const metadataBlock of setupRoute.matchAll(/user_metadata:\s*\{([\s\S]*?)\}/g)) {
  assert.doesNotMatch(metadataBlock[1], /\brole\s*:/);
  assert.doesNotMatch(metadataBlock[1], /\bclient_id\s*:/);
}
assert.match(setupRoute, /userUpsertError/);
assert.match(setupRoute, /inviteUpdateError/);

console.log("Auth role hardening tests passed.");
