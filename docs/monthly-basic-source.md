# Monthly federal safety measures

The public FMCSA SMS Complete Profile is an available source without carrier credentials. `lib/fmcsa/public-basic-measures.ts` reads its labeled release date and matches the seven category headings to their measure cells. It rejects a wrong carrier, changed structure, invalid/future date or malformed number. Missing private values stay null; zero is recorded only when the source explicitly says zero. A release older than the existing 45-day threshold is labeled stale.

Staff can inspect a read-only result at `/api/operator/basic-source/<USDOT number>`, or run `npx tsx scripts/fetch-public-basic-measures.ts <USDOT number>`. No database record or notification is created. Test fixtures use only the public heading/date/measure section captured September 23, 2026.

For Nationwide (2533650), the September 23 public response still describes the August 28 release: driving 7.61, driving hours 1.43, vehicle maintenance 5.15, drugs/alcohol 0, driver qualifications 1.04. Crash and hazardous-material measures are not public. Percentiles and alerts are not inferred. Source: https://ai.fmcsa.dot.gov/SMS/Carrier/2533650/CompleteProfile.aspx.

## Recommended rollout and alternatives

1. Use this dated public source for public measures when QCMobile returns stale values. Keep the authenticated all-BASICs CSV upload for private measures and percentiles.
2. Obtain approval for scheduled writes before connecting this source to `basic_measure_releases` or the monitoring refresh. The current goal explicitly forbids changing Nationwide data. This change therefore does not silently enable those writes or claim that monthly persistence is complete.
3. Once authorized, store each distinct carrier/release/source with the existing unique key, never replace a newer release with an older one, and verify the displayed release date within a week of a new monthly release. A changed/blocked public page must fail visibly and fall back to requesting an authenticated export.
4. Alternatively, use the existing authenticated all-BASICs upload every release. It requires the carrier's portal access and a named operator; public measures alone cannot replace restricted data.

Live database proof on September 23: Nationwide's September 17 score snapshot has `basics_stale=true`, `basics_sms_run_date=2017-01-27`, and null unsafe-driving/vehicle-maintenance measures. Its most recent stored `basic_measure_releases` row is the August 28 public profile captured September 16. This source work leaves both records unchanged.
