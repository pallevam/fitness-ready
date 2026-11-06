# Research context: read before any product, design or eval work

The running summary of what we know about users of fitness wearables and AI
coaches. Read it before proposing features, writing evals or making design calls,
and cite its findings rather than intuition.

- **Decisions** live in `design/eval-product-redesign.md`. **Evidence** lives here.
- **Raw tagged items** are in `design/research/<source>.jsonl`; per-source write-ups
  in `design/research/<source>.md`.

**Last updated:** 6 Nov 2026. **Evidence base:** 939 tagged public complaints, plus
one founder's 6 weeks of daily use.

## Findings

Confidence is **High** when several independent sources agree, **Medium** when one
source is strong, **Low** when it is suggestive.

| # | Finding | Confidence | Evidence |
|---|---|---|---|
| F1 | **Builders' top pain is data access.** Unofficial APIs break in waves (2023, 2024, 2026), and each wave breaks every Garmin library at once. | High | 70% of GitHub issues, 24% of HN |
| F2 | **Mainstream users' pain is broken basics:** sync, app redesigns, accuracy. Data access barely registers. | High | App Store: 30% sync and app, 16% accuracy; data access 6–7% |
| F3 | **Generic, black-box insights frustrate engaged users most.** "Your readiness is 62" with no reason or action. | Medium | Reddit 20%, highest upvotes |
| F4 | **The vendors' AI coaches are seen as shallow or wrong.** Connect+ "rephrases existing data"; Whoop Coach uses stale data and pushes plans nobody asked for; Fitbit's Gemini coach invents things; Oura Advisor is generic. | High | Reddit 15%, power-user forums 23%, HN |
| F5 | **People already pipe wearable data into general LLMs themselves:** FIT files to CSV to Gemini, Oura to SQLite to Claude, ChatGPT projects, Garmin MCP servers. | High | 40 items mention ChatGPT, Claude, Gemini or MCP, across all four sources |
| F6 | **Their failures are about meaning, not transport:** a 1–4 sleep score read as out of 10, km read as metres, timezone and date shifts, outputs too large. | Medium | GitHub issues on MCP servers; matches the founder's bugs (F10) |
| F7 | **The most-wanted data is the device's derived scores** (Body Battery, training status, HRV status, recovery), not raw signals. | Medium | GitHub feature requests |
| F8 | **Privacy is a split.** A vocal group will not send health data to OpenAI or Anthropic and wants analysis done locally. | Medium | HN (7% privacy, strongly worded) |
| F9 | **What people love is changed behaviour**, not data: quitting alcohol, getting sleep apnoea diagnosed. Behaviour change is rarely complained about, but heavily upvoted when it is. | Medium | App Store five-star reviews; Reddit 5% |
| F10 | **Founder, 6 weeks:** used a general AI tool with raw data access 26 times against 4 uses of the purpose-built coach. Bugs surfaced when a number contradicted memory. Advice did not change behaviour. | Low (one user) | `exports/context-2026-11-06.md` (gitignored) |
| F11 | **Users want to edit wrong data** (sleep segments, phantom workouts), because one error skews every downstream score. | Low | Garmin forums |

## External facts

| Fact | Status | Source |
|---|---|---|
| Garmin reopened its Connect developer API on 21 Oct 2026: free Personal tier (own data) and free Startup tier (up to 1,000 users); paid Enterprise from Apr 2027. JSON summaries and FIT files, with some proprietary fields stripped. | Verified (article) | DC Rainmaker, 2026-10 |
| The Personal key is read-only. | **Unverified** (commenters) | same |
| Garmin's terms bar using the data to "create or maintain any AI model, AI system or AI generated knowledge base". | **Unverified, critical: check before building on the API** | same, quoted by a commenter |
| The vívoactive 5's FIT files carry undocumented message 140, which holds aerobic and anaerobic TE, recovery minutes and VO2 max that the Garmin app doesn't show. | Verified on 7 activities | this repo, 21 Oct 2026 |

## Method and caveats

- **Pain taxonomy** (one primary tag per item): accuracy, data_access, insight_quality,
  subscription_cost, hardware_battery, sync_app_reliability, ai_coach_quality,
  privacy, behaviour_change, other.
- **The rankings average shares across sources**, each weighted equally, so no single
  source's volume dominates.
- **Source biases:**
  - HN and GitHub lean toward builders.
  - Reddit was read through a third-party archive, with early upvote counts.
  - Fitbit's migration to Google is 41% of the App Store low ratings.
  - The Apple feed was patchy (no COROS reviews, only 50 for Garmin).
- **Complaints aren't demand.** They show pain, not willingness to switch or pay.
  Validate with interviews or a prototype before treating a finding as a requirement.

## Open research questions

- Do persona-B users pay for, or switch to, a better answer layer, or just tolerate it?
- How large is the local-first-only group, compared with users happy to use cloud LLMs?
- Garmin API terms: is AI use actually allowed, and on which tier?
- Apple Health and Health Connect: what is the access story for an independent app?

## Updating this file

- Add or revise a finding when new evidence arrives. Keep the ID; never renumber.
- Each row needs a confidence level and evidence a reader can trace.
- When a finding changes, update its row and add a dated line to the change log;
  git history keeps the old wording.
- Keep the file under about two pages. Detail belongs in the per-source files.

## Change log

- **6 Nov 2026:** created from the four-source pain-point pass (939 items) and the
  founder's usage review.
