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
   system message for the v1 run, `prompts/system_v2.md` for v2. Version both in
   Langfuse rather than editing in place, so runs stay comparable.
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
  point-wise, bucket B only. Run `evals/judge_prompt_v1.md` first if you are
  showing the length-bias beat.
- **Evaluation** node (Set Metrics) records everything in SPEC §9.3. Latency and
  token cost come from Langfuse, not from n8n.

## Langfuse

Sign in at <http://localhost:3000>, create a project, put the keys in `.env`, and
restart n8n. Trace the agent so every run carries its prompt version — the
before/after comparison in the demo is only credible if the trace says which
prompt produced it.
