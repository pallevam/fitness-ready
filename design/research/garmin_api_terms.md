# Garmin Connect API terms after the Oct 2026 revamp (checked 2026-11-13)

Garmin calls the middle tier **Starter**, not "Startup".

| # | Question | Verdict |
|---|---|---|
| 1 | Tiers: Personal = own data; Starter = organizations, limited users; Enterprise = paid, unlimited | Confirmed (fees come from commentary only) |
| 2 | Clause banning "AI generated knowledge base" | Unclear: not in the public agreement |
| 3 | Personal is read-only; write APIs start at Starter | Confirmed |
| 4 | Backfill: Enterprise only | Confirmed. Personal depth: Unclear |
| 5 | Data coverage | Mostly confirmed; no training status or recovery time |
| 6 | Sublicensing restricted; OAuth 2.0; rate limits | Confirmed; rate limits not published |

## Quotes

**1.** Overview (https://developer.garmin.com/gc-developer-program/overview/):
- Personal: "your own Garmin Connect data", "Pull only".
- Starter: "for organizations", "Push only", historical "Not included", users "Limited".
- Enterprise: "1 month +" historical, "Unlimited" users, terms "tailored".

Personal FAQ (/gc-developer-program/personal/personal-faq/): "not intended for commercial applications serving multiple end users." The "$1,000 entry fee" and "up to 1,000 users" figures come from DC Rainmaker, not Garmin.

**2.** Agreement FRM-0952 Rev. B (https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf, file dated March 2026) has no "knowledge base" wording. Instead, §15.10 requires an "AI Transparency Statement" if data is used "for training with or processing by artificial intelligence systems", plus "explicit consent from each End User" that users can withdraw. The ban wording appears only in DC Rainmaker reader comment #61, which names no source. It may come from the Personal T&C, which sits behind login.

**3.** The Personal Swagger spec (/gc-developer-program/personal/swagger-docs/) has 26 endpoints, all `GET`. Courses and Training APIs are listed only under Starter and Enterprise.

**4.** Personal endpoints take date ranges ("up to a maximum of 31 days"; daily summaries up to "1 year") with no stated lower bound. Commentary conflicts: Tredict says the API returns "current activities" only, while a DC Rainmaker commenter reports downloading "historical ones" too.

**5.** The Personal spec covers:
- sleep, HRV, Body Battery, stress, `restingHeartRate`
- activities, plus the activity file "in its original format"
- `aerobicTrainingEffect`, `activityTrainingLoad`, `vO2MaxValue`

It has no training status or recovery time. Runalyze and the5krunner (commentary) report that Garmin stripped "undocumented… fields" (VO2 max, recovery time) from FIT files, then rolled it back on 19 March. Unconfirmed for Personal.

**6.** Rev. B:
- §4.1: the license is "non-sublicensable" and data is for "internal business purposes".
- §5.2(o) bars "developing a Licensee application programming interface to provide End User Data to third-party… platforms… not approved by Garmin in writing".
- §5.2(q) bars integrating the API with other software "unless authorized… in writing".

Program FAQ: "All APIs… use OAUTH 2.0." Personal tokens are "valid for 24 hours", with no refresh tokens. No rate limits are published.

## Implications for a connector product

- **Commercial use means Starter.** Personal is single-user and non-commercial. Starter has no backfill, so day-one answers will rest on thin history.
- **§5.2(o) is the biggest risk.** An MCP endpoint that feeds Claude or ChatGPT closely matches its wording. We should get written approval from Garmin before building. Not legal advice.
- **The AI terms add work but do not block us.** We need an AI Transparency Statement and per-user revocable consent, and we still have to find the source of the "knowledge base" clause.
- **Starter is push-only.** We would receive webhooks instead of fetching on a schedule, so storing nothing means processing in flight.
- **Missing metrics and free alternatives.** Training status and recovery time are absent. Free OSS Personal-API MCP servers already exist (e.g. github.com/indaco/garmin-personal-mcp), so interpretation has to be the differentiator.
