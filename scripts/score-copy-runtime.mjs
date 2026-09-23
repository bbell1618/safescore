// Local TypeScript loader for the one-off maintenance scripts and existing tests.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
export function loadTs(filename) {
  const absolute = path.resolve(root, filename);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const compiledModule = { exports: {} };
  cache.set(absolute, compiledModule);
  const code = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const resolveImport = (name) => {
    if (name === "server-only") return {};
    // Maintenance supplies its guarded service client; never create another client.
    if (name === "@/lib/supabase/server") return { createServiceClient() { throw new Error("Supply the guarded maintenance client"); } };
    if (!name.startsWith("@/") && !name.startsWith(".")) return nativeRequire(name);
    const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(absolute), name);
    const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${name} from ${absolute}`);
    return loadTs(resolved);
  };
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${code}\n})`, { filename: absolute })(resolveImport, compiledModule, compiledModule.exports, absolute, path.dirname(absolute));
  return compiledModule.exports;
}
