# GitHub: what developers struggle with in their own wearable data

233 issues from 2023 onward, drawn from about 60 repos (Garmin libraries, Apple Health exporters, MCP servers for intervals.icu, Strava, Oura and Whoop, Home Assistant integrations). Score = reactions + comments (keyword-search hits count comments only); total 2,281. 70% of the issues are about Garmin, because Garmin has no personal API and the most-used open-source libraries. Each issue is in `github.jsonl`.

## Ranked pain clusters

| # | Cluster | Issues | Score |
|---|---|---|---|
| 1 | data_access: auth / rate limit | 54 | 910 |
| 2 | data_access: missing field / endpoint | 51 | 365 |
| 3 | data_access: export / import format | 31 | 281 |
| 4 | other: install / packaging of self-hosted tools | 29 | 227 |
| 5 | data_access: API deprecation / migration | 14 | 189 |
| 6 | data_access: write / upload (workouts, weight) | 13 | 107 |
| 7 | accuracy (timezones, units, wrong enums) | 20 | 71 |
| 8 | sync_app_reliability | 6 | 84 |
| 9 | ai_coach_quality (MCP / LLM over the data) | 8 | 13 |
| 10 | insight_quality / privacy / subscription_cost | 7 | 34 |

**1. Auth breaks (40% of all engagement).** The highest-scoring issues are Garmin login outages: "Did Garmin change authentication API?" ([168](https://github.com/cyberjunky/python-garminconnect/issues/332)); "429 Too Many Requests on /mobile/api/login, persists even from browser/curl without any code" ([96](https://github.com/matin/garth/issues/217)); "Broke again? … Did not find the display name" ([42](https://github.com/pe-st/garmin-connect-export/issues/95)). *What developers want:* a login that keeps working, tokens that refresh on their own, and a clear message when they are rate-limited instead of a stack trace.

**2. Missing fields and endpoints.** Requests cover body battery, HRV, Training Status/Load, Running Tolerance, lactate threshold, device battery, women's health, lifestyle logging, golf, and intraday data older than 6 months ([42](https://github.com/arpanghosh8453/garmin-grafana/issues/77)). *What developers want:* every metric the watch app shows, with history.

**3. Export formats.** Apple Health's `export.xml` runs out of memory or fails to parse ("Apple Health import error - insufficient memory", [76](https://github.com/OpenVitals-MTU/android-app/issues/72)). Beat-to-beat HRV is not exported ([7](https://github.com/Lybron/health-auto-export/issues/53)). *What developers want:* incremental, streaming, typed exports.

**4. Self-hosting tax.** Many issues are pip, Docker, Python-version or MCP SDK breakage ("Fresh install fails with MCP 2.0", [16](https://github.com/Taxuspt/garmin_mcp/issues/226)). *What developers want:* a single binary or container that installs in one step and does not break on upgrade.

**5. Forced API migrations.** The Fitbit Web API is moving to the Google Health API (4+ repos), Strava has 2026 endpoint deprecations, and Whoop moved to API v2. *What developers want:* an abstraction that insulates them from vendor churn.

**7. Accuracy.** Sleep timestamps are off by 8h on UTC+8 accounts ([#405](https://github.com/cyberjunky/python-garminconnect/issues/405)). A HEART_RATE workout target maps to a power zone. *What developers want:* correct local-day semantics.

**9. AI over the data.** "Claude thinks [sleep quality] is out of 10 instead of out of 4, so assumes a 3 (average) is terrible" ([intervals-mcp#48](https://github.com/mvilanova/intervals-mcp-server/issues/48)). A 0.87 km ride was reported as "0.87 metres" ([apple-health-mcp#1](https://github.com/neiltron/apple-health-mcp/issues/1)). *What developers want:* units and scales stated in the schema, and paginated, compact tool output.

## Surprising findings

1. **Auth breaks come in waves, and every downstream tool breaks at once.** Clusters: Sep–Oct 2023 (9 issues, the Garmin SSO change that forced the Cloudscraper-to-garth move), Nov 2024, and Mar–Apr 2026 (14 issues, 429s on mobile login). Each wave broke every Garmin library, Home Assistant integration and MCP server together. An agent on unofficial Garmin auth should expect to be down for days about once a year.
2. **The most-requested data is the vendor's own derived scores** (body battery, training status/load, readiness, running tolerance, HRV status), not raw signals. Developers want the vendor's numbers in their own store.
3. **People are already building AI coaches on top of MCP servers** (intervals, Garmin, Strava, Apple Health, Oura). Their bugs are about meaning: scales, units, timezones, token bloat.
4. **Write access is in demand.** Developers want to push structured workouts and training plans back to the watch.
5. **Paywalls, privacy and battery barely appear on GitHub** (3 issues in total). Developers accept the vendor; they fight the pipe.
