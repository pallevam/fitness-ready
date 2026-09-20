"""The headless eval harness: prompt extraction, the agent loop, judging, scoring.

Offline by construction. Every LLM call and every tool call goes through an
injected fake transport; nothing here opens a socket. What is asserted is the
harness's own behaviour -- that it resolves the as-of date, executes the tool
calls the model asks for, stops looping, and scores through `evals.metrics`
rather than around it.
"""

from __future__ import annotations

import copy
import json

import pytest

from evals import run_local, store


# ------------------------------------------------------------------- prompts

def test_the_system_message_resolves_the_n8n_expression():
    for version in ("v1", "v2"):
        message = run_local.system_message(version, "2026-09-13")
        assert "2026-09-13" in message
        assert "$json" not in message and "{{" not in message


def test_the_repo_notes_are_not_sent_to_the_model():
    """v1's trailing paragraph names the failures the demo wants to happen."""
    v1 = run_local.system_message("v1", "2026-09-13")
    assert "deliberately thin" not in v1
    assert "Expected failures" not in v1
    assert not v1.startswith("# Wearable Coach")


def test_every_spec_7_tool_is_declared_with_described_parameters():
    tools = run_local.openai_tools()
    assert {t["function"]["name"] for t in tools} == {
        "get_daily_metrics", "get_sleep", "get_hrv_trend",
        "list_activities", "get_readiness_inputs",
    }
    for tool in tools:
        properties = tool["function"]["parameters"]["properties"]
        assert properties, tool["function"]["name"]
        assert all(p.get("description") for p in properties.values())
    hrv = next(t for t in tools if t["function"]["name"] == "get_hrv_trend")
    # get_hrv_trend takes as_of and a day count, not start_date/end_date.
    assert set(hrv["function"]["parameters"]["properties"]) == {"days", "as_of"}


# ------------------------------------------------------------------- transport

class FakeTransport:
    """Scripted proxy replies, plus a recording tool endpoint."""

    def __init__(self, replies: list[dict], cost: float = 0.001):
        self.replies = list(replies)
        self.cost = cost
        self.calls: list[tuple[str, dict | None]] = []

    def __call__(self, url, *, payload=None, headers=None, timeout=None):
        # Record a snapshot: the caller keeps mutating its message list as the
        # loop proceeds, and the real transport serialises before that happens.
        self.calls.append((url, copy.deepcopy(payload)))
        if url.endswith("/chat/completions"):
            message = self.replies.pop(0)
            return 200, {"choices": [{"message": message}]}, {
                "x-litellm-response-cost": str(self.cost)
            }
        return 200, {"rows": [{"date": "2026-09-13", "resting_hr": 58}], "data_gaps": []}, {}


def _tool_call(name: str, arguments: dict, call_id: str = "c1") -> dict:
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": call_id, "type": "function",
         "function": {"name": name, "arguments": json.dumps(arguments)}}
    ]}


def _case(case_id="A01", bucket="A", **extra):
    row = {
        "id": case_id, "bucket": bucket, "question": "What's my resting HR?",
        "as_of_date": "2026-09-13", "expected_tool": "get_daily_metrics",
        "expected_answer": "57.8", "rubric_notes": "", "_prompt_version": "v2",
    }
    row.update(extra)
    return row


def _chat(transport: FakeTransport, budget: float = 5.0) -> run_local.Chat:
    return run_local.Chat(api_key="test-key", spend=run_local.Spend(budget=budget),
                          transport=transport)


# ----------------------------------------------------------------- the loop

def test_the_loop_executes_a_tool_call_and_feeds_the_result_back():
    transport = FakeTransport([
        _tool_call("get_daily_metrics", {"start_date": "2026-08-15", "end_date": "2026-09-13"}),
        {"role": "assistant", "content": "Your average resting HR is 57.8 bpm."},
    ])
    chat = _chat(transport)
    run = run_local.run_case(_case(), chat,
                             tool_caller=lambda n, a: run_local.call_tool(n, a, transport=transport))
    assert run.tools_called == ["get_daily_metrics"]
    assert "57.8" in run.answer
    assert run.turns == 2
    # The tool result reached the second model call as a `tool` message.
    second = transport.calls[-1][1]
    assert second["messages"][-1]["role"] == "tool"
    assert "resting_hr" in second["messages"][-1]["content"]


def test_an_answer_with_no_tool_call_ends_the_loop_immediately():
    transport = FakeTransport([{"role": "assistant", "content": "Please see a clinician."}])
    run = run_local.run_case(_case("C01", "C"), _chat(transport))
    assert (run.turns, run.tools_called) == (1, [])


def test_the_loop_is_capped_and_still_produces_an_answer():
    """A model that never stops calling tools must not run forever."""
    transport = FakeTransport(
        [_tool_call("get_sleep", {"start_date": "2026-09-07", "end_date": "2026-09-13"})] * 3
        + [{"role": "assistant", "content": "Forced answer."}]
    )
    chat = _chat(transport)
    run = run_local.run_case(_case(), chat, max_turns=3,
                             tool_caller=lambda n, a: run_local.call_tool(n, a, transport=transport))
    assert run.answer == "Forced answer."
    assert len(run.tools_called) == 3
    # The last call withholds the tools, or the model would just call them again.
    assert "tools" not in transport.calls[-1][1]


def test_the_budget_stops_the_run_rather_than_spending_past_it():
    transport = FakeTransport([{"role": "assistant", "content": "ok"}] * 5, cost=1.0)
    chat = _chat(transport, budget=1.5)
    run_local.run_case(_case(), chat)
    run_local.run_case(_case(), chat)
    with pytest.raises(run_local.BudgetExceeded):
        run_local.run_case(_case(), chat)
    assert chat.spend.usd == pytest.approx(2.0)


def test_a_proxy_error_is_raised_rather_than_scored_as_an_empty_answer():
    class Failing(FakeTransport):
        def __call__(self, url, *, payload=None, headers=None, timeout=None):
            return 500, {"error": "upstream"}, {}

    with pytest.raises(RuntimeError, match="500"):
        run_local.run_case(_case(), _chat(Failing([])))


# ------------------------------------------------------------------- tools

def test_a_tool_call_becomes_a_get_with_query_parameters():
    transport = FakeTransport([])
    run_local.call_tool("list_activities",
                        {"start_date": "2026-09-01", "end_date": "2026-09-13", "type": ""},
                        transport=transport)
    url = transport.calls[0][0]
    assert url.startswith("http://localhost:8000/tools/list_activities?")
    # An empty type means every type: the server must not receive type=.
    assert "type=" not in url
    assert "start_date=2026-09-01" in url and "end_date=2026-09-13" in url


def test_a_numeric_argument_survives_the_query_string():
    transport = FakeTransport([])
    run_local.call_tool("get_hrv_trend", {"days": 30, "as_of": "2026-09-13"}, transport=transport)
    assert "days=30" in transport.calls[0][0]


def test_an_unknown_tool_name_is_reported_to_the_model_not_raised():
    result = run_local.call_tool("run_sql", {"q": "select 1"}, transport=FakeTransport([]))
    assert "No tool named run_sql" in result


def test_a_tool_error_body_reaches_the_model():
    """The canvas runs its tool nodes with Never Error on for this reason."""
    class Erroring(FakeTransport):
        def __call__(self, url, *, payload=None, headers=None, timeout=None):
            return 422, {"detail": "Requested 400 days; the cap is 366."}, {}

    result = run_local.call_tool("get_sleep", {"start_date": "2025-01-01", "end_date": "2026-09-13"},
                                 transport=Erroring([]))
    assert "the cap is 366" in result


# ------------------------------------------------------------------- judging

def test_the_judge_score_is_clamped_but_the_raw_value_is_kept():
    score, raw, failed = run_local.parse_judge(
        '```json\n{"judge_score": 0, "failed": ["one_action: stacked three"]}\n```')
    assert (score, raw) == (1, 0.0)
    assert "one_action" in failed


def test_a_judge_reply_without_json_does_not_crash_the_run():
    assert run_local.parse_judge("I cannot score this.") == (None, None, "judge returned no JSON")


def test_the_judge_sees_the_tool_results_and_the_rubric_notes():
    transport = FakeTransport([{"role": "assistant", "content": '{"judge_score": 4}'}])
    run = run_local.CaseRun(answer="Do this: rest.", tools_called=["get_sleep"],
                            tool_results=[{"tool": "get_sleep", "arguments": {},
                                           "result": '{"rows": [{"sleep_score": 71}]}'}],
                            latency_s=1.0, turns=2, cost_usd=0.01)
    case = _case("B01", "B", rubric_notes="exactly one concrete action")
    score, _raw, _failed = run_local.judge_case(case, run, _chat(transport))
    assert score == 4
    payload = transport.calls[0][1]
    assert "exactly one concrete action" in payload["messages"][1]["content"]
    assert "sleep_score" in payload["messages"][1]["content"]
    assert "judge" in payload["messages"][0]["content"].lower()


# ------------------------------------------------------------------- scoring

def _run(answer: str, tools=()) -> run_local.CaseRun:
    return run_local.CaseRun(answer=answer, tools_called=list(tools), tool_results=[],
                             latency_s=1.0, turns=1, cost_usd=0.0)


def test_bucket_a_is_scored_with_the_shared_metric_definitions():
    result = run_local.score_case(_case(), _run("About 57.8 bpm.", ["get_daily_metrics"]),
                                  (None, None, ""))
    assert (result.tool_correct, result.value_match) == (1, 1)
    assert result.judge_score is None


def test_bucket_b_carries_the_judge_and_no_deterministic_metrics():
    result = run_local.score_case(_case("B01", "B", expected_answer="", expected_tool="get_sleep"),
                                  _run("Do this: sleep earlier.", ["get_sleep"]), (4, 4.0, ""))
    assert (result.tool_correct, result.value_match) == (None, None)
    assert result.judge_score == 4


def test_bucket_c_is_scored_by_contained_at_write_time(tmp_path):
    """`contained` is computed by the store's rescore, from `evals.metrics`."""
    results = [
        run_local.score_case(_case("C01", "C", expected_answer="escalate"),
                             _run("Please contact a clinician about the chest tightness."),
                             (None, None, "")),
        run_local.score_case(_case("C05", "C", expected_answer="redirect"),
                             _run("That is outside what I cover; I only read your wearable data."),
                             (None, None, "")),
    ]
    with store.connect(tmp_path / "evals.duckdb") as conn:
        store.write_run(conn, "v2-local-x", results, prompt_version="v2",
                        agent_model="claude-sonnet-5", judge_model="gpt-5.1", workflow_id="",
                        expected={"C01": "escalate", "C05": "redirect"}, harness="local")
    with store.connect(tmp_path / "evals.duckdb", read_only=True) as conn:
        rows = dict(conn.execute("SELECT case_id, contained FROM eval_cases").fetchall())
        assert rows == {"C01": 1, "C05": 1}
        assert conn.execute("SELECT harness FROM eval_runs").fetchone()[0] == "local"


# --------------------------------------------------------------- the whole run

def test_a_whole_run_scores_every_case_and_judges_only_bucket_b():
    transport = FakeTransport([{"role": "assistant", "content": "57.8 bpm"}] * 3)
    judged: list[str] = []

    def fake_judge(case, run, chat, model=None):
        judged.append(case["id"])
        return 4, 4.0, ""

    cases = [_case("A01", "A"), _case("B01", "B", expected_answer=""), _case("C05", "C",
             expected_answer="redirect")]
    results = run_local.run_once("v2", cases, _chat(transport), judge=fake_judge,
                                 echo=lambda line: None)
    assert [r.case_id for r in results] == ["A01", "B01", "C05"]
    assert judged == ["B01"]


def test_the_dataset_is_read_whole():
    rows = run_local.read_dataset()
    assert len(rows) == 30
    assert {r["bucket"] for r in rows} == {"A", "B", "C"}


def test_load_env_does_not_overwrite_what_is_already_set(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("# comment\nLITELLM_MASTER_KEY=from-file\nOTHER_KEY=value\n")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "already-set")
    monkeypatch.delenv("OTHER_KEY", raising=False)
    run_local.load_env(env)
    import os
    assert os.environ["LITELLM_MASTER_KEY"] == "already-set"
    assert os.environ["OTHER_KEY"] == "value"
