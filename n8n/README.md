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

1. **Set** node writes `as_of_date`. Default it to `{{ $now.format('yyyy-MM-dd') }}`;
   the eval workflow overrides it per case so ground truth stays stable.
2. **AI Agent** node, Tools Agent type. Paste `prompts/system_v1.md` into the
   system message for the v1 run, `prompts/system_v2.md` for v2.

   For the **Chat Model**, use the **OpenAI Chat Model** node — not the Anthropic
   node — pointed at the LiteLLM proxy. n8n's AI Agent does not emit Langfuse
   traces, so every call has to leave through the proxy or it is invisible:

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
3. Five **HTTP Request Tool** nodes, `GET`, "Send Query Parameters" on. The tool
   *name* must match the dataset's `expected_tool` exactly — that string is what
   `tool_correct` scores.

| Tool name | URL | Query parameters |
|---|---|---|
| `get_daily_metrics` | `http://tools:8000/tools/get_daily_metrics` | `start_date`, `end_date` |
| `get_sleep` | `http://tools:8000/tools/get_sleep` | `start_date`, `end_date` |
| `get_hrv_trend` | `http://tools:8000/tools/get_hrv_trend` | `days`, `as_of` |
| `list_activities` | `http://tools:8000/tools/list_activities` | `start_date`, `end_date`, `type` |
| `get_readiness_inputs` | `http://tools:8000/tools/get_readiness_inputs` | `date` |

Let the model fill each parameter (`fromAI`), and copy the endpoint's `summary`
from `http://localhost:8000/docs` into the tool description — the description is
what the model routes on, so it is a prompt, not documentation.

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
