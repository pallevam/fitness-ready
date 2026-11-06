# Eval and product redesign

The living record of the redesign. Each decision is one commit, so `git log -p
design/eval-product-redesign.md` shows how the design evolved. Research inputs
live in `design/research/`.

**Goal:** build something people, tech folks first, find useful and love.
Usability before monetisation; resources are not the constraint.

**Started:** 6 Nov 2026, from the personal Garmin coach in this repo.

## Segments

| # | Segment | Decision it settles | Status |
|---|---|---|---|
| 1 | User and job | Which tech person, which recurring pain, how often | **Research done**; persona B proposed, awaiting decision |
| 2 | Wedge | The one thing we do that Garmin, Whoop and Oura's AI coaches can't | Open |
| 3 | Product shape | App, chat bot, CLI, or a plug-in for the AI tools people already use | Open |
| 4 | Data access | Garmin Health API, Apple Health, Health Connect, FIT uploads: legal and scalable | Open |
| 5 | Trust layer | Evals: LLM-coach benchmark (a) or device accuracy (b) | Open |
| 6 | First version and build plan | What ships in 4–6 weeks, what is kept from today, what is dropped | Open |

## Decision log

Newest first. One line per decision: date, decision, why, what it rules out.

- **6 Nov:** keep one doc. Evals move to their own file at segment 5, once rubrics
  and cases exist.
- **6 Nov:** research done: 939 complaints from HN, GitHub, Reddit and app stores
  plus forums. Results are in segment 1.

- **6 Nov:** start with segment 1, grounded in public complaints, not our intuition.
  Research is a quick pass over four source groups (Hacker News, GitHub issues,
  Reddit, app-store reviews with power-user forums). Why: the current product was
  shaped for a demo and then for one user; neither is evidence of what others need.

## Starting evidence: one user, 6 weeks (the founder)

What using the current coach showed (details in the gitignored context brief):

- **The n8n coach lost to a general AI tool with raw data access.** 26 "sync"
  requests to Claude Code against 4 uses of the built coach. What won: any field on
  demand, no word cap, fixes in the same conversation.
- **Bugs were found by memory contradicting a number**, not by evals: a 14 km run
  saved in two parts, a night labelled with the wrong date, recovery that never
  failed, an HR spike. Synthetic evals missed all of them.
- **The device hides useful data.** Recovery time, training effect and VO2 max are
  computed on the watch but exposed only inside the FIT file.
- **Advice did not change behaviour.** Race pacing, easy-run limits and bedtime were
  all exceeded.
- **The founder exports data to other LLMs for a second opinion** about once a week.

## Segment 1: user and job

### Research (6 Nov): 939 complaints from four source groups

| Source | Items | Coverage | Caveat |
|---|---|---|---|
| Hacker News | 245 | 2024 – Nov 2026 | Comment score is the thread's score |
| GitHub issues | 233 | 2023+, about 60 repos | Tags from keywords, about 100 corrected by hand |
| Reddit | 196 | Dec 2025 – Sep 2026 | Reddit blocks direct reads; read through a third-party archive, with early upvote counts |
| App Store and forums | 265 | 2024–26 | Apple feed patchy (no COROS, only 50 Garmin); Fitbit migration is 41% of the low ratings |

Shares within each source, then averaged with each source weighted equally:

| Pain | Avg | HN | GitHub | Reddit | App Store+ |
|---|---|---|---|---|---|
| Data access, lock-in | 27% | 24% | 70% | 7% | 6% |
| Accuracy | 15% | 12% | 9% | 22% | 16% |
| Sync, app reliability | 13% | 10% | 3% | 8% | 30% |
| Insight quality (generic, black box) | 9% | 10% | 2% | 20% | 4% |
| AI coach quality | 7% | 2% | 3% | 15% | 8% |
| Subscription cost | 7% | 12% | 0% | 4% | 11% |
| Hardware, battery | 6% | 10% | 0% | 10% | 3% |
| Privacy | 3% | 7% | 1% | 2% | 2% |
| Behaviour change | 2% | 3% | 0% | 5% | 0% |

("Other", mostly redesign and UX complaints, averages 13%.) Per-source detail is in
`design/research/*.md`; the raw tagged items are in `*.jsonl`.

### Hypotheses, checked

- **H1: data access hurts tech users most. Confirmed for builders.** It is 70% of
  GitHub and the top pain on HN. Unofficial Garmin libraries break in waves
  (2023, 2024, 2026). Mainstream users barely mention it (6–7%).
- **H2: generic insights frustrate. Confirmed among engaged users.** On Reddit it is
  20% of complaints and draws the most upvotes.
- **H3: the vendor AI coaches are seen as shallow. Confirmed.** Connect+ is
  "rephrasing existing data"; Whoop Coach uses stale data and pushes plans nobody
  asked for; Fitbit's Gemini coach invents things; Oura Advisor is generic.
- **H4: behaviour change is the unspoken pain. Partly.** It is rarely complained
  about (2%) but heavily upvoted when it is, and five-star reviews praise
  *changed habits*, not data.

### Signals for persona B (AI-native athlete)

- **40 items mention ChatGPT, Claude, Gemini or MCP.** People already pipe wearable
  data into LLMs: FIT files to CSV to Gemini (said to beat Connect+), Oura to SQLite
  to Claude, ChatGPT projects holding health data, and Garmin MCP servers that keep
  breaking.
- **Developer bugs in those pipelines are about meaning, not transport.** A 1–4 sleep
  score is read as out of 10, km is read as metres, timezones shift, outputs are too
  large. These are the same failures this repo's derived layer already fixed: night
  labels, split runs, wake-day dating.
- **The counter-signal is privacy.** A vocal HN group will not send health data to
  OpenAI or Anthropic and wants analysis "done locally". Local-first is a design
  constraint, not a feature.

### External change: Garmin's official API (21 Oct 2026, DC Rainmaker)

The Garmin Connect developer programme reopened with a free **Personal** tier and a
free **Startup** tier (up to 1,000 users). It provides JSON summaries plus full FIT
files, with some proprietary fields stripped. **Unverified, and must be checked before
segment 4:** commenters say the Personal key is read-only, and quote a terms clause
barring use to "create or maintain any AI model, AI system or AI generated knowledge
base".

### Proposed decision (awaiting the founder)

**Beachhead: B, the AI-native athlete.** They already use an assistant daily and
already try to pipe their wearable data into it; their pain is broken pipes and
misread data, and the vendors' own AI coaches disappoint them. A, the tinkerer, is
the distribution channel. C (goal-driven) and D (sleep and stress) follow once the
engine is trusted.

## Open questions

- Segment 5: (a) LLM-coach benchmark or (b) device accuracy?
- Does "tech folks" mean developers who code against their data, or technical people
  who just want better answers?
