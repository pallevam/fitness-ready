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
| 1 | User and job | Which tech person, which recurring pain, how often | **In progress**: pain-point research running |
| 2 | Wedge | The one thing we do that Garmin, Whoop and Oura's AI coaches can't | Open |
| 3 | Product shape | App, chat bot, CLI, or a plug-in for the AI tools people already use | Open |
| 4 | Data access | Garmin Health API, Apple Health, Health Connect, FIT uploads: legal and scalable | Open |
| 5 | Trust layer | Evals: LLM-coach benchmark (a) or device accuracy (b) | Open |
| 6 | First version and build plan | What ships in 4–6 weeks, what is kept from today, what is dropped | Open |

## Decision log

Newest first. One line per decision: date, decision, why, what it rules out.

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

*Waiting on research.* Hypotheses to test against the complaints:

- **H1.** Tech users' top pain is **data access and lock-in**, not accuracy.
- **H2.** **Generic, unactionable insights** ("your readiness is 62") frustrate more
  than missing metrics.
- **H3.** The new AI coaches (Whoop Coach, Oura Advisor, Garmin Connect+) are seen as
  shallow or paywalled.
- **H4.** Behaviour change is the unspoken pain: people have data but don't act on it.

## Open questions

- Segment 5: (a) LLM-coach benchmark or (b) device accuracy?
- Does "tech folks" mean developers who code against their data, or technical people
  who just want better answers?
