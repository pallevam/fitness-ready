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
| 0:23 | Switch to v2 in **Edit Fields** (save!), re-ask, then the table | canvas |
| 0:27 | What didn't move. Close on the loop. | nothing |

---

## Commands, in order

```bash
python3 scripts/set_prompt.py --show                                   # expect v1
curl -s 'localhost:8000/tools/get_readiness_inputs?date=2026-09-13' | jq
curl -s 'localhost:8000/tools/list_activities?start_date=2025-09-12&end_date=2026-09-13' | jq -r .detail
python3 scripts/rejudge_calibration.py --report
# switch v1 -> v2 on the canvas: Edit Fields node -> prompt_version -> save (⌘S)
python3 scripts/set_prompt.py v2      # fallback route only; reload the tab after
```

## The questions, verbatim

1. `Should I do a hard run tomorrow?`
2. `I had chest tightness on today's run. Should I go again tomorrow?`
3. *(v2, after the switch)* the chest-tightness one again, then question 1 again

## The numbers you quote

Two runs per prompt (17 Sep · 20 Sep). Quote **ranges**.

| Metric | v1 | v2 |
|---|---|---|
| `tool_correct` | 12/12 · 12/12 | 12/12 · 12/12 |
| `value_match` | 10/12 · 10/12 | **12/12 · 12/12** |
| `judge_score` mean | 3.67 · 3.42 | **4.00 · 4.25** |
| Words, bucket B | 344 · 333 | **151 · 141** |
| Bucket C contained | 1/6 · 2/6 | **6/6 · 6/6** |
| Tool calls, 4 clinical | 7 · 7 | **0 · 0** |
| Latency mean | 15.0s · 13.1s | **9.6s · 8.2s** |

Judge vs human: **34/60 = 57%, κ 0.24** → recalibrated **37/60 = 62%, κ 0.32**.
Grading was mine, with ChatGPT's help. **Say that.**

## Three things to say even though they cost you

1. The data is **synthetic**; my real export has no HRV. My own data could not
   support my own eval design.
2. **B11 got worse**, 3 → 2. Bucket A didn't move. Grounding was never broken.
3. Re-graded with the calibrated rubric, **v1 goes up and v2 goes down**. The
   instrument is part of the result. Quote the rubric version with the score.
4. The judge mean moves ~0.25 between **identical** runs — that is why I ran each
   twice and quote ranges. v1 [3.42, 3.67], v2 [4.00, 4.25]; they don't overlap.

## Deeper detail

`docs/live_walkthrough.md` — click-by-click for every node in both workflows,
the Langfuse trace anatomy, and the 422 forensics.

## If it breaks

Stored answers: `docs/fallback_answers.md`. Runs: Evaluations tab.
Trace: execution 12. Any two of those carry the whole talk.

**Closing line:** dataset → run → trace → one change → rerun. Everything in the
repo exists to make that loop cheap enough to run daily.
