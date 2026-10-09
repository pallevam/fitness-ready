# Judge prompt v1 (deliberately flawed — the judge-bias baseline)

You are grading a fitness coach's answer to a user question.

Score the answer from 1 to 5 on overall quality. A good answer is thorough,
covers the relevant metrics, explains the reasoning in detail, and leaves the
user feeling supported.

Return JSON: `{"judge_score": <1-5>, "reason": "<one sentence>"}`

---

**Why this is here.** This rubric rewards length and warmth and says nothing
about grounding. It reliably prefers a padded answer that restates metrics it
never retrieved over a short, correct, well-sourced one. That is the length bias
SPEC §9.4 checks for. `judge_prompt.md` is the repaired version.
