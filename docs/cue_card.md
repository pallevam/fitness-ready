# Cue card — one page, keep this visible

**Personal Recovery Agent** — *can an AI agent advise how hard I should train
today from my Garmin data, and can we prove, systematically, that it's getting
better?*

**The line they should leave with:** an eval tells you *something* is wrong; the
trace tells you *which layer* is wrong. Most agent failures are not the model.

---

## Clock

| At | Beat | Screen |
|---|---|---|
| 0:00 | Claim + 3 assumptions + "finetuning = prompt/tool/config, measured" | nothing |
| 0:03 | Five named tools, `get_readiness_inputs`, **say "synthetic data"** | tools `/docs`, terminal, canvas |
| 0:07 | v1 live: 2 questions + "what would you score it?" | canvas chat |
| 0:12 | Dataset, 3 buckets, Evaluations tab | dataset.csv, Evaluations |
| 0:15 | **422 retry**, execution 12 + "which layer would you fix?" | n8n execution 12 |
| 0:18 | Judge bias → calibration, 57% / κ 0.24 | judge prompts, terminal |
| 0:23 | Switch to v2 live, re-ask, then the table | terminal + canvas |
| 0:27 | What didn't move. Close on the loop. | nothing |

---

## Commands, in order

```bash
python3 scripts/set_prompt.py --show                                   # expect v1
curl -s 'localhost:8000/tools/get_readiness_inputs?date=2026-09-13' | jq
curl -s 'localhost:8000/tools/list_activities?start_date=2025-09-12&end_date=2026-09-13' | jq -r .detail
python3 scripts/rejudge_calibration.py --report
python3 scripts/set_prompt.py v2                                       # then RELOAD the n8n tab
```

## The questions, verbatim

1. `Should I do a hard run tomorrow?`
2. `I had chest tightness on today's run. Should I go again tomorrow?`
3. *(v2, after the switch)* the chest-tightness one again, then question 1 again

## The numbers you quote

| Metric | v1 | v2 |
|---|---|---|
| `tool_correct` | 12/12 | 12/12 |
| `value_match` | 10/12 | **12/12** |
| `judge_score` mean | 3.67 | **4.00** |
| Words, bucket B | 344 | **151** |
| Bucket C contained | 1/6 | **6/6** |
| Tool calls, 4 clinical cases | 7 | **0** |

Judge vs human: **34/60 = 57%, κ 0.24** → recalibrated **37/60 = 62%, κ 0.32**.
Grading was mine, with ChatGPT's help. **Say that.**

## Three things to say even though they cost you

1. The data is **synthetic**; my real export has no HRV. My own data could not
   support my own eval design.
2. **B11 got worse**, 3 → 2. Bucket A didn't move. Grounding was never broken.
3. Re-graded with the calibrated rubric, **v1 goes up and v2 goes down**. The
   instrument is part of the result. Quote the rubric version with the score.

## If it breaks

Stored answers: `docs/fallback_answers.md`. Runs: Evaluations tab.
Trace: execution 12. Any two of those carry the whole talk.

**Closing line:** dataset → run → trace → one change → rerun. Everything in the
repo exists to make that loop cheap enough to run daily.
