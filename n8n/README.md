# n8n workflows

`workflow_agent.json` and `workflow_eval.json` land here as exports once
Phases 3 and 5 are built on the canvas (SPEC §12). This file is the build sheet
for them, so the canvas work is reproducible rather than remembered.

Start the stack first: `cp .env.example .env && docker compose up -d`, then open
<http://localhost:5678>. From inside n8n the tools server is `http://tools:8000`
(not `localhost`, which is the n8n container itself).

## workflow_agent

```
Chat Trigger ──► Set (as_of_date) ──► AI Agent ──► Respond
                                        ├── Chat Model      (agent model)
                                        ├── Memory          (window buffer, 10)
                                        └── Tools           (5 × HTTP Request Tool)
```

1. **Set** node writes `as_of_date`. It is pinned to the literal `2026-09-13` —
   the last day the fixture covers, and the last day the real Garmin export
   covers too. `{{ $now.format('yyyy-MM-dd') }}` looks more natural and returns
   empty data from every tool, because there is no data after the 13th.

   **This assignment is unconditional, and Phase 5 has to change it.** The eval
   workflow sets `as_of_date` from the dataset row before calling this workflow;
   an unconditional Set overwrites that value on every case. Today all 30 cases
   are pinned to `2026-09-13`, so the bug is invisible — the run produces correct
   results for the wrong reason, and stays correct only until someone adds a case
   on another date. When wiring Phase 5, change the value to:

   ```
   ={{ $json.as_of_date || '2026-09-13' }}
   ```

   which takes the row's date when there is one and keeps the pinned default for
   hand-driven chat runs.

   **Turn on "Include Other Input Fields".** Without it the Set node emits only
   `as_of_date` and `chatInput` never reaches the agent, so the agent answers an
   empty question. This costs an entire debugging session to find, because
   nothing errors.

2. **AI Agent** node, Tools Agent type.

   Because the Set node sits between the Chat Trigger and the agent, the agent is
   *not* directly connected to the trigger and cannot find the user message on its
   own. Set:

   | Field | Value |
   |---|---|
   | Prompt source (`promptType`) | **Define below** |
   | Prompt (User Message) | `={{ $json.chatInput }}` |
   | Return Intermediate Steps | **on** |

   Return Intermediate Steps is not optional: Phase 5 scores `tool_correct` from
   those steps, and without them the eval workflow has no record of which tools
   were called.

   **System Message — switch the field to Expression mode** (hover the field, click
   the gear, "Add Expression"). Left in Fixed mode, `{{ $json.as_of_date }}` is
   passed to the model as those literal characters and the agent has no idea what
   day it is.

   Paste the **prompt body only** from `prompts/system_v1.md` or `system_v2.md` —
   stop at the horizontal rule. The notes under it describe the failures v1 is
   expected to make; handing those to the model is telling it the answers to the
   test.

3. **Chat Model**: use the **OpenAI Chat Model** node — not the Anthropic node —
   pointed at the LiteLLM proxy. n8n's AI Agent does not emit Langfuse traces, so
   every call has to leave through the proxy or it is invisible:

   | Credential field | Value |
   |---|---|
   | Base URL | `http://litellm:4000/v1` |
   | API Key | your `LITELLM_MASTER_KEY` from `.env` |

   Then type the model name by hand: `claude-sonnet-5` for the agent. The
   credential's test call hits `/models`, which LiteLLM serves, so a green tick
   confirms the proxy is reachable before you run anything.

   Models the proxy exposes (see `litellm/config.yaml`): `claude-sonnet-5`,
   `claude-opus-5`, `gpt-5.1`, `gemini-2.5-pro`. Provider keys live only in the
   proxy — n8n holds none.

4. Five **HTTP Request Tool** nodes (`httpRequestTool`), `GET`, "Send Query
   Parameters" on. **Add them from the AI Agent's Tool socket**, not from its main
   output — a node wired to the main output is a workflow step, not a tool, and
   the agent will never call it.

   The tool *name* must match the dataset's `expected_tool` exactly; that string
   is what `tool_correct` scores.

   | Tool name | URL |
   |---|---|
   | `get_daily_metrics` | `http://tools:8000/tools/get_daily_metrics` |
   | `get_sleep` | `http://tools:8000/tools/get_sleep` |
   | `get_hrv_trend` | `http://tools:8000/tools/get_hrv_trend` |
   | `list_activities` | `http://tools:8000/tools/list_activities` |
   | `get_readiness_inputs` | `http://tools:8000/tools/get_readiness_inputs` |

   Copy each endpoint's `summary` from <http://localhost:8000/docs> into the tool
   description. The description is what the model routes on — it is a prompt, not
   documentation.

### Parameter expressions

**Do not use the ✨ auto-override button.** It generates
`$fromAI('parameters0_Value', ``, 'string')` — an unnamed parameter with an empty
description, which the model has to guess at. Write the three-argument form
yourself, `$fromAI(name, description, type)`, and leave each parameter's **Name**
field on **Fixed** (only the Value is an expression).

`get_daily_metrics` and `get_sleep`:

| Name | Value |
|---|---|
| `start_date` | `={{ $fromAI('start_date', 'First day of the range, inclusive, as YYYY-MM-DD', 'string') }}` |
| `end_date` | `={{ $fromAI('end_date', 'Last day of the range, inclusive, as YYYY-MM-DD. Ranges span at most 366 days.', 'string') }}` |

`get_hrv_trend` — note it takes `as_of`, **not** `end_date`, and a day count
rather than a start date:

| Name | Value |
|---|---|
| `days` | `={{ $fromAI('days', 'How many nights back to look, 1 to 366. Use 30 unless the question asks for a different window.', 'number') }}` |
| `as_of` | `={{ $fromAI('as_of', 'Last night of the window, as YYYY-MM-DD. Use the current as-of date.', 'string') }}` |

`list_activities` — `type` is optional, and an empty string means every type:

| Name | Value |
|---|---|
| `start_date` | `={{ $fromAI('start_date', 'First day of the range, inclusive, as YYYY-MM-DD', 'string') }}` |
| `end_date` | `={{ $fromAI('end_date', 'Last day of the range, inclusive, as YYYY-MM-DD. Ranges span at most 366 days.', 'string') }}` |
| `type` | `={{ $fromAI('type', 'Optional activity type filter: running, walking, badminton, strength_training, cycling, swimming, yoga, indoor_cardio. Pass an empty string for all types.', 'string') }}` |

`get_readiness_inputs`:

| Name | Value |
|---|---|
| `date` | `={{ $fromAI('date', 'The day to assess, as YYYY-MM-DD. Use the current as-of date unless the user names another day.', 'string') }}` |

### Let the tools report their own errors

On **every** tool node: **Add Option → Response → Never Error = on**.

By default n8n converts a non-2xx into a thrown error and hands the model only
`Request failed with status code 422`. The server's `detail` — which names the
limit and the corrected call — never reaches it. Observed on 2026-09-15: the
agent asked for a 366-day range against the old 365-day cap, got a bare 422,
**re-sent the identical request three times**, then gave up and split the year
into quarters. Five model calls to recover from one fixable mistake.

With Never Error on, the response body is returned to the model as a normal tool
result, and it corrects itself on the next turn. This applies to the eval
workflow's tool nodes too — an eval run that silently burns retries reports
inflated latency and cost for reasons that have nothing to do with the prompt
you are testing.

## workflow_eval

```
Evaluation Trigger (Google Sheet: dataset) ──► Set (as_of_date from the row)
   ──► Execute Workflow: workflow_agent
   ──► Code: deterministic metrics     ──► Evaluation (set metrics)
   ──► LLM Chain: judge (bucket B only) ──┘
```

- **Evaluation Trigger** reads the sheet built from `evals/dataset.csv`
  (`id, bucket, question, as_of_date, expected_tool, expected_answer, rubric_notes`).
- **Code** node computes `tool_correct`, `value_match`, `escalated` and
  `judge_length_words`. Port `evals/metrics.py` directly — keeping the two
  implementations in step is what lets the demo show the same number twice.
- **Judge**: a separate model and a separate prompt (`evals/judge_prompt.md`),
  point-wise, bucket B only. Use a second OpenAI Chat Model node against the
  same proxy credential with `claude-opus-5`, `gpt-5.1` or `gemini-2.5-pro`.
  Swapping judge models is then a one-field change, which makes "does the
  ranking hold across judges?" a question you can answer live. Run
  `evals/judge_prompt_v1.md` first if you are showing the length-bias beat.
- **Evaluation** node (Set Metrics) records everything in SPEC §9.3. Latency and
  token cost come from Langfuse, not from n8n.

## Langfuse

Sign in at <http://localhost:3000>, create a project, and put the keys in `.env`
as `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`, then
`docker compose up -d litellm`. **The proxy writes the traces, not n8n** — n8n
holds no Langfuse credentials at all. Check that it works with:

```bash
set -a; . ./.env; set +a
curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" "localhost:3000/api/public/traces?limit=3"
```

Each trace carries the model, latency, token counts and computed cost, which is
where SPEC §9.3's `latency_ms`, `input_tokens`, `output_tokens` and `cost_usd`
come from.

### Grouping calls into one session

LiteLLM reads these request headers and passes them to Langfuse (verified on
this stack):

| Header | Effect in Langfuse |
|---|---|
| `x-litellm-session-id` | sets `sessionId`, grouping calls into one session |
| `x-litellm-trace-id` | stable trace id for correlating a conversation |
| `x-litellm-tags` | comma-separated, becomes trace `tags` |

**What n8n can and cannot do with these.** The OpenAI credential supports
exactly one custom header (an on/off toggle plus a name and value), and
credentials are resolved outside per-item context — so expressions like
`{{$json.id}}` will not resolve there. In practice:

- **Run-level grouping works.** Set `headerName: x-litellm-session-id` and
  `headerValue: eval-run-v1`, and every call in that run lands in one Langfuse
  session. Edit the value to `eval-run-v2` before the v2 run and the two runs
  separate cleanly — which is exactly the comparison the demo needs.
- **Per-case metadata does not.** Passing the eval case id per row would need a
  different header on every request, which the credential cannot express. If you
  want per-case tagging, replace the Chat Model node with an **HTTP Request**
  node calling `http://litellm:4000/v1/chat/completions` directly and set
  `x-litellm-tags` from the row — at the cost of giving up the AI Agent node's
  built-in tool loop. For a 30-case set, run-level grouping plus the case id in
  the prompt is the better trade.
