# SafeScore: 10-minute Daven walkthrough

Use production at `https://safescore.vercel.app`. Sign in as GEIA staff before the meeting. Use a carrier/DOT approved for the demonstration; the examples below use Nationwide Carrier Inc, DOT 2533650, because its imported record is already populated. Do not create or file a real DataQ/CPDP during the walkthrough.

## 0:00-1:15 - Quick Assess a prospect

1. Open the public home page and enter DOT `2533650` in Quick Assess.
2. Explain that the public lookup establishes the SAFER-authoritative company snapshot before GEIA creates a client file.
3. Show the carrier identity, operating facts, official FMCSA measures where published, and the direct path into the staff workspace.

Talking point: “SafeScore starts with the carrier’s real FMCSA identity. We do not invent percentiles when FMCSA does not publish them.”

## 1:15-3:30 - Tour the client file

1. Open Nationwide Carrier Inc from **Clients**.
2. On the overview, point to the exact columns:
   - **In-window weighted burden (points)**
   - **Scored violations (count)**
   - **Potential removal impact (points)**
3. Explain that burden is not a violation count and removal impact is not a promise. Unknown BASIC rows remain explicit rather than disappearing.
4. Open **Violations** and show the canonical inspection-level records.
5. Open **Compliance** and show that all six areas are computed from real violations, drivers, and fleet inputs; missing rosters say insufficient data.

Talking point: “The product separates what is on the record, how heavily it weighs, and what evidence may support a correction.”

## 3:30-5:20 - Lanes and the Action queue

1. Open **Remediation**.
2. Show **What next** and the ordered lanes:
   - Lane A: eligible crashes to CPDP review.
   - Lane B: genuinely erroneous violations to DataQs, only with supporting evidence.
   - Lane C: legitimate violations to coaching, maintenance, compliance controls, and 24-month age-out.
3. Point out the exact limitation: **Investigate means evidence is needed, not that the violation is removable.**
4. Show the Action queue and the separate operational-burden section.

Talking point: “We do the highest-leverage work first, but the interface prevents us from overselling a possible challenge.”

## 5:20-6:45 - Show the client portal

1. In a separate browser profile, sign in to a beta client account prepared for the walkthrough.
2. Show **Safety**, **Your Safety Plan**, **Cases**, **Requests**, **Documents**, and **Reports**.
3. In **Requests**, explain that only client-owned asks appear. GEIA-obtained work such as PAR retrieval never becomes a client to-do.
4. Show reminder count/escalation behavior verbally; do not trigger live mail. Production remains in email dry-run until launch approval.

Talking point: “The client sees a short, honest list of what only they can provide, while GEIA owns the rest.”

## 6:45-8:10 - Generate the report

1. Return to the staff profile and open **Reports**.
2. Generate/download the safety report.
3. Show the PDF’s carrier snapshot, official FMCSA measures, computed burden, open cases, and representative violations.
4. Explain that the report uses stored canonical data and the same burden function as the client file; it does not recalculate from a stale or unrelated snapshot.

Talking point: “The PDF is an output of the same data layer, not a separate spreadsheet.”

## 8:10-9:25 - Monitoring and ongoing service

1. Open **Monitoring**.
2. Contrast **FMCSA official measures** with **SafeScore computed burden**.
3. Show the snapshot history and explain that changes are net record movement after each refresh.
4. Explain the monthly operating loop: refresh, identify new activity, request only missing client evidence, remediate, report.

## 9:25-10:00 - The money story

- **Monitor — $199/month:** monitoring and visibility.
- **Remediate — $599/month:** active case/evidence and remediation work.
- **Total Safety — $999/month + $29/driver/month:** full managed safety service; billing uses the client-stated driver count, while MCS-150 driver count remains a reference.

Close with: “SafeScore turns safety data into a recurring service: see the record clearly, correct only what evidence supports, fix the operational remainder, and prove improvement over time.”

## Before Daven arrives

- Complete every item marked “Required before beta walkthrough” in `LAUNCH_CHECKLIST.md`.
- Confirm the staff and beta-client sessions both work.
- Confirm the selected carrier has populated safety data and a report can be generated.
- Keep email dry-run enabled and do not submit any real FMCSA filing during the demo.
