import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccountSourceInfo,
  CopyableAccountValue,
} from "../components/portal/account-interactions";

const accountPage = readFileSync(
  resolve(process.cwd(), "app/(portal)/portal/account/page.tsx"),
  "utf8"
);
const interactions = readFileSync(
  resolve(process.cwd(), "components/portal/account-interactions.tsx"),
  "utf8"
);
const accountServer = readFileSync(
  resolve(process.cwd(), "lib/portal/account-server.ts"),
  "utf8"
);

assert.equal(accountPage.match(/<CopyableAccountValue/g)?.length, 4);
assert.equal(accountPage.match(/<AccountSourceInfo/g)?.length, 2);
assert.ok(accountPage.includes("<PortalMotionSection"));
assert.ok(accountPage.includes("interactive"));
assert.ok(accountPage.includes("hover:-translate-y-0.5"));

assert.ok(interactions.includes("navigator.clipboard?.writeText"));
assert.ok(interactions.includes('aria-live="polite"'));
assert.ok(interactions.includes('document.addEventListener("pointerdown"'));
assert.ok(interactions.includes('event.key === "Escape"'));
assert.ok(interactions.includes('event.pointerType !== "touch"'));
assert.ok(interactions.includes("min-h-10"));
assert.ok(interactions.includes("focus-visible:outline"));
assert.ok(interactions.includes("onClick={() => setOpen(true)}"));
assert.ok(interactions.includes("motion-reduce:transform-none"));
assert.equal(
  (accountPage.match(/motion-reduce:transform-none/g) ?? []).length,
  2
);
assert.doesNotMatch(
  `${accountPage}\n${interactions}\n${accountServer}`,
  /\.insert\(|\.update\(|\.upsert\(|\.delete\(/
);

const copyMarkup = renderToStaticMarkup(
  <CopyableAccountValue label="USDOT number" value="2533650" mono />
);
assert.ok(copyMarkup.includes("Copy USDOT number: 2533650"));
assert.ok(copyMarkup.includes(">2533650<"));
assert.ok(copyMarkup.includes("min-h-10"));

const sourceMarkup = renderToStaticMarkup(
  <AccountSourceInfo
    label="FMCSA SAFER · as of Jul 28, 2026"
    explanation="FMCSA SAFER is the public company snapshot."
  />
);
assert.ok(sourceMarkup.includes("FMCSA SAFER · as of Jul 28, 2026"));
assert.ok(sourceMarkup.includes('aria-expanded="false"'));

console.log(
  JSON.stringify(
    {
      passed: true,
      copyTargets: ["USDOT", "MC", "phone", "email"],
      sourceAffordances: 2,
      touchTarget: "min-height 40px",
      dismissals: ["tap away", "pointer leave", "Escape", "blur"],
      feedback: ["Copied", "Copy unavailable"],
    },
    null,
    2
  )
);
