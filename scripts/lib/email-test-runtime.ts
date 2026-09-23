import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

/** Execute real templates/transport branching with an in-memory outbox and forbidden SMTP. */
export function emailTestRuntime() {
  const saved: Array<Record<string, unknown>> = [];
  const logs: unknown[][] = [];
  const runtime = { env: { EMAIL_DRY_RUN: "true" } };
  let failure: string | null = null;
  const compile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const copy = { exports: {} }; vm.runInNewContext(compile("lib/email/copy.ts"), { module: copy, exports: copy.exports });
  const email = { exports: {} };
  vm.runInNewContext(compile("lib/email/client.ts"), {
    module: email, exports: email.exports, process: runtime, Error,
    console: Object.fromEntries(["log", "info", "warn", "error"].map(key => [key, (...args: unknown[]) => logs.push(args)])),
    require: (name: string) => {
      if (name === "./copy") return copy.exports;
      if (name === "nodemailer") return { createTransport: () => { throw new Error("SMTP forbidden in tests"); } };
      if (name === "./outbox") return { writeDryRunOutbox: async (message: Record<string, unknown>) => {
        if (failure) throw new Error(failure);
        saved.push(message); return `outbox-${saved.length}`;
      } };
      throw new Error(`Unexpected email test import: ${name}`);
    },
  });
  return { email: email.exports as typeof import("../../lib/email/client"), saved, logs, runtime, fail: (message: string | null) => { failure = message; } };
}
