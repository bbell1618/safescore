# Monthly federal safety measures

The public FMCSA SMS Complete Profile is an available source without carrier credentials. `lib/fmcsa/public-basic-measures.ts` reads its labeled release date and matches the seven category headings to their measure cells. It rejects a wrong carrier, changed structure, invalid/future date or malformed number. Missing private values stay null; zero is recorded only when the source explicitly says zero. A release older than the existing 45-day threshold is labeled stale.

Staff can inspect a read-only result at `/api/operator/basic-source/<USDOT number>`, or run `npx tsx scripts/fetch-public-basic-measures.ts <USDOT number>`. No database record or notification is created. Test fixtures use only the public heading/date/measure section captured September 23, 2026.

For Nationwide (2533650), the September 23 public response still describes the August 28 release: driving 7.61, driving hours 1.43, vehicle maintenance 5.15, drugs/alcohol 0, driver qualifications 1.04. Crash and hazardous-material measures are not public. Percentiles and alerts are not inferred. Source: https://ai.fmcsa.dot.gov/SMS/Carrier/2533650/CompleteProfile.aspx.

## Recommended rollout and alternatives

1. Use this dated public source for public measures when QCMobile returns stale values. Keep the authenticated all-BASICs CSV upload for private measures and percentiles.
2. Brandon authorized new dated Nationwide BASIC rows on September 23. The existing authenticated daily monitoring job now checks this public source for Nationwide only. `savePublicBasicMeasures` validates the stored client/DOT and current source, then inserts a new carrier/release/source row. A duplicate or older release is reported and never overwrites history. Existing QCMobile archival also uses conflict-ignore rather than updating a duplicate.
3. Verify the stored release date within a week of a new monthly release. A changed/blocked public page or stale release reports the real failure in the monitoring response's errors; private measures and percentiles still require an authenticated export. The `public_basic_results` response distinguishes inserted, already_present and older_than_saved. No new cron path, migration, notification or proxy change is needed.
4. Alternatively, use the existing authenticated all-BASICs upload every release. It requires the carrier's portal access and a named operator; public measures alone cannot replace restricted data.

Scoped verification: `npx tsx scripts/save-public-basic-measures.ts <client UUID> <USDOT>` previews the source; add `--apply` to run the same insert-only helper. The script accepts only Nationwide and the explicitly disposable goal-loop fixture. It never runs the full monitoring sweep. Do not invent a newer release date when the source still publishes August 28. Existing score snapshots remain historical; this work does not rewrite them.
