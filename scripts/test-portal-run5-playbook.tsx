import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlaybookPrograms,
  type PlaybookProgramView,
} from "../components/portal/playbook-programs";

const programs: PlaybookProgramView[] = [
  {
    id: "playbook-program-1",
    familyName: "Tires",
    count: 4,
    points: 32,
    inflowRatePerMonth: 0.5,
    trailingWindowDays: 90,
    riskContext: "Tire condition can turn a routine stop into an outage.",
    program: ["Inspect tread before dispatch."],
    workingWhen: ["New tire violations stop."],
    installments: ["Pre-trip tire card"],
    introduction: "Start with the tire pattern.",
    coachingLanguage: "Keep the check short and repeatable.",
  },
  {
    id: "playbook-program-2",
    familyName: "Lighting",
    count: 2,
    points: 8,
    inflowRatePerMonth: 0.25,
    trailingWindowDays: 90,
    riskContext: "Lighting defects are visible during roadside checks.",
    program: ["Check lamps before departure."],
    workingWhen: ["No new lamp violations appear."],
    installments: ["Lighting check card"],
    introduction: "Move to lighting after tires.",
    coachingLanguage: "Make lamp checks part of every pre-trip.",
  },
];

const html = renderToStaticMarkup(
  createElement(PlaybookPrograms, { programs })
);

assert.match(html, /aria-label="Playbook program navigation"/);
assert.match(html, /href="#playbook-program-1"/);
assert.match(html, /aria-current="location"/);
assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 1);
assert.match(html, /Start with the tire pattern/);
assert.doesNotMatch(html, /Move to lighting after tires/);
assert.match(html, /min-h-10/);
assert.match(html, /focus-visible:ring-2/);

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const component = source("components/portal/playbook-programs.tsx");
const page = source("app/(portal)/portal/playbook/page.tsx");

assert.match(component, /new Set\(programs\[0\] \? \[programs\[0\]\.id\] : \[\]\)/);
assert.match(component, /<AnimatePresence initial=\{false\}>/);
assert.match(component, /animate=\{\{ height: "auto", opacity: 1 \}\}/);
assert.match(component, /new IntersectionObserver/);
assert.match(component, /aria-current=\{isActive \? "location" : undefined\}/);
assert.match(component, /scrollIntoView\(\{/);
assert.match(component, /behavior: reduceMotion \? "auto" : "smooth"/);
assert.match(component, /aria-controls=\{panelId\}/);
assert.match(component, /aria-expanded=\{isOpen\}/);
assert.match(component, /active:bg-amber\/5/);
assert.match(component, /hover:border-sand hover:bg-cream/);
assert.match(component, /hover:border-sand hover:bg-warm-white/);
assert.doesNotMatch(component, /localStorage|sessionStorage|fetch\(|\.insert\(|\.update\(|\.upsert\(/);

assert.match(page, /<PlaybookPrograms/);
assert.match(page, /programs=\{playbook\.family_programs\.map/);
assert.ok(
  page.indexOf('getPortalPageAccess("playbook_coach")') <
    page.indexOf("loadLatestPortalPlaybook(access.clientId)")
);
assert.doesNotMatch(page, /\blane\s+c\b|template version|mapping review/i);

console.log(
  JSON.stringify(
    {
      passed: true,
      playbook: {
        focusOneOpenByDefault: true,
        remainingProgramsCollapsed: true,
        stickyJumpNavigation: true,
        scrollActiveState: true,
        reducedMotion: true,
        readOnly: true,
      },
    },
    null,
    2
  )
);
