import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { collectEmailPreviews } from "./email-preview-harness.mjs";

const output = resolve(process.argv[2] ?? "../scratch/email-samples");
await mkdir(output, { recursive: true });
const previews = await collectEmailPreviews();
const inventory = [];
for (const preview of previews) {
  const filename = `${preview.name}.html`;
  await writeFile(join(output, filename), preview.htmlBody);
  inventory.push({ file: filename, function: preview.function, template: preview.template, subject: preview.subject, source: "lib/email/client.ts", status: "Rendered offline; transport unavailable" });
}
const resetDraft = await readFile("content/email/password-recovery-draft.html", "utf8");
await writeFile(join(output, "password-recovery-PROPOSED.html"), resetDraft.replace("{{ .ConfirmationURL }}", "https://safescore.vercel.app/update-password"));
inventory.push({ file: "password-recovery-PROPOSED.html", source: "content/email/password-recovery-draft.html", status: "PROPOSED ONLY. Live Supabase Auth template NOT VERIFIED or changed." });
await writeFile(join(output, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
await writeFile(join(output, "README.md"), "# SafeScore email previews\n\nNationwide sample data only. No email was sent. Links are ordinary public page URLs with no invitation/recovery tokens and do not perform account setup.\n\n12 application samples cover all 11 client-facing functions (two case types). Password recovery is a proposed draft, not a capture of live Supabase Auth configuration. Operations notifications are staff-only and outside this client-facing inventory.\n\nOpen inventory.json for exact source/function/subject mapping.\n");
console.log(JSON.stringify({ output, applicationSamples: previews.length, proposedRecoverySamples: 1, sent: 0, networkAvailable: false }, null, 2));
