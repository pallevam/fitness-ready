"""Eval dashboard: DuckDB in, juxtaposed plots out.

Two ways to use it:

    # 1. Interactively. Open in VS Code and run cell by cell -- the `# %%`
    #    markers make this a notebook. Or: jupytext --to ipynb this file.
    # 2. As a script, to get one standalone page you can keep open on stage:
    python notebooks/eval_dashboard.py      # -> notebooks/eval_dashboard.html

Reads `evals.duckdb` (eval runs) and `wearable-real.duckdb` (real Garmin data),
both read-only. Every chart is a builder function so the notebook and the page
render exactly the same figures.

Colours: two series only, v1 and v2, using a validated adjacent pair from the
data-viz palette (blue/orange, CVD ΔE 24.7 light / 26.8 dark). Red is reserved
for status and never used as a series colour.
"""

# %%
from __future__ import annotations

import os
from pathlib import Path

import duckdb
import pandas as pd
import plotly.graph_objects as go
import plotly.io as pio
from plotly.subplots import make_subplots

from evals import classification

REPO = Path(__file__).resolve().parent.parent
EVAL_DB = Path(os.environ.get("EVAL_DB", REPO / "evals.duckdb"))
REAL_DB = REPO / "wearable-real.duckdb"

V1, V2 = "#2a78d6", "#eb6834"
INK, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e6e5e0", "#fcfcfb"
STATUS_BAD = "#e34948"

pio.templates["coach"] = go.layout.Template(layout=go.Layout(
    font=dict(family="Inter, -apple-system, Segoe UI, sans-serif", size=13, color=INK),
    paper_bgcolor=SURFACE, plot_bgcolor=SURFACE,
    xaxis=dict(gridcolor=GRID, zeroline=False, linecolor=GRID, ticks="outside", tickcolor=GRID),
    yaxis=dict(gridcolor=GRID, zeroline=False, linecolor=GRID, ticks="outside", tickcolor=GRID),
    legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0, font=dict(color=MUTED)),
    margin=dict(l=64, r=24, t=64, b=48), bargap=0.25, bargroupgap=0.08,
))
pio.templates.default = "coach"


def q(sql: str, db: Path = EVAL_DB) -> pd.DataFrame:
    with duckdb.connect(str(db), read_only=True) as conn:
        return conn.execute(sql).df()


def runs_table() -> pd.DataFrame:
    return q("""
        SELECT r.run_id, r.prompt_version AS prompt, r.harness, r.judge_model AS judge,
               r.ran_at, r.cases,
               round(avg(c.judge_score) FILTER (c.bucket = 'B'), 2) AS judge_mean,
               round(avg(c.words) FILTER (c.bucket = 'B')) AS words,
               count(*) FILTER (c.bucket = 'C' AND c.contained = 1) AS contained,
               sum(c.tool_count) FILTER (c.bucket = 'C' AND c.expected_answer = 'escalate')
                   AS clinical_tool_calls,
               round(avg(c.latency_s), 1) AS latency_s
        FROM eval_runs r JOIN eval_cases c USING (run_id)
        GROUP BY ALL ORDER BY r.ran_at
    """)


def classification_table() -> pd.DataFrame:
    rows = q("""SELECT r.run_id, r.prompt_version, c.case_id, c.expected_answer,
                       c.expected_tool, c.tools_called, c.answer
                FROM eval_runs r JOIN eval_cases c USING (run_id)
                WHERE r.harness = 'canvas' ORDER BY r.ran_at, c.case_id""")
    by_run: dict[str, list[dict]] = {}
    prompt_of: dict[str, str] = {}
    for row in rows.to_dict("records"):
        prompt_of[row["run_id"]] = row["prompt_version"]
        by_run.setdefault(row["run_id"], []).append(row)
    table = pd.DataFrame(classification.report(by_run))
    table["prompt"] = table["run_id"].map(prompt_of)
    table["label"] = table["prompt"] + " · " + table["run_id"].str[5:10]
    return table


def bucket_b() -> pd.DataFrame:
    return q("""SELECT c.case_id, r.prompt_version AS prompt, avg(c.judge_score) AS judge,
                       avg(c.words) AS words
                FROM eval_runs r JOIN eval_cases c USING (run_id)
                WHERE r.harness = 'canvas' AND c.bucket = 'B'
                GROUP BY ALL ORDER BY c.case_id""")


# ------------------------------------------------------------------ figures

def fig_classifier(clf: pd.DataFrame) -> go.Figure:
    """Recall and tool precision side by side, one panel each (never one axis for both)."""
    fig = make_subplots(rows=1, cols=2, horizontal_spacing=0.14,
                        subplot_titles=("Escalation recall (4 red flags per run)",
                                        "Tool-call precision"))
    for metric, col in (("esc_recall", 1), ("tool_precision", 2)):
        for version, colour in (("v1", V1), ("v2", V2)):
            part = clf[clf["prompt"] == version]
            fig.add_bar(x=part["label"], y=part[metric].fillna(0), name=version,
                        marker_color=colour, marker_line_width=0,
                        text=[("0.00" if pd.isna(v) else f"{v:.2f}") for v in part[metric]],
                        textposition="outside", cliponaxis=False,
                        legendgroup=version, showlegend=(col == 1), row=1, col=col)
    fig.update_yaxes(range=[0, 1.18], title_text="recall", row=1, col=1)
    fig.update_yaxes(range=[0, 1.18], title_text="precision", row=1, col=2)
    fig.update_layout(height=430, barmode="group", hovermode="closest",
                      title="v1 misses red flags and wastes calls; v2 catches all four, twice")
    return fig


def fig_judge_per_case(b: pd.DataFrame) -> go.Figure:
    pivot = b.pivot(index="case_id", columns="prompt", values="judge")
    fig = go.Figure()
    for version, colour in (("v1", V1), ("v2", V2)):
        fig.add_bar(x=pivot.index, y=pivot[version], name=version, marker_color=colour,
                    marker_line_width=0, text=[f"{v:.1f}" for v in pivot[version]],
                    textposition="outside", cliponaxis=False)
    for case in pivot.index[pivot["v2"] < pivot["v1"]]:
        fig.add_annotation(x=case, y=pivot.loc[case, "v2"] + 0.55, text="worse",
                           showarrow=False, font=dict(color=STATUS_BAD, size=11))
    fig.update_layout(title="Judge score per bucket B case, mean of runs (1–5)",
                      yaxis_title="judge score", yaxis_range=[0, 6], barmode="group",
                      height=430, hovermode="x unified")
    return fig


def fig_words(b: pd.DataFrame) -> go.Figure:
    words = b.pivot(index="case_id", columns="prompt", values="words")
    fig = go.Figure()
    for version, colour in (("v1", V1), ("v2", V2)):
        fig.add_bar(y=words.index, x=words[version], name=version, orientation="h",
                    marker_color=colour, marker_line_width=0)
    fig.add_vline(x=150, line=dict(color=MUTED, dash="dot", width=1),
                  annotation_text="v2's 150-word cap", annotation_position="top")
    fig.update_layout(title="Answer length per bucket B case (words)", xaxis_title="words",
                      barmode="group", height=540, hovermode="y unified")
    return fig


def fig_latency(runs: pd.DataFrame) -> go.Figure:
    canvas = runs[runs["harness"] == "canvas"]
    fig = go.Figure()
    for version, colour in (("v1", V1), ("v2", V2)):
        part = canvas[canvas["prompt"] == version]
        fig.add_bar(x=part["run_id"].str[5:10], y=part["latency_s"], name=version,
                    marker_color=colour, marker_line_width=0,
                    text=[f"{v:.1f}s" for v in part["latency_s"]],
                    textposition="outside", cliponaxis=False)
    fig.update_layout(title="Mean seconds per case — the shorter answer is also the faster one",
                      yaxis_title="seconds", barmode="group", height=380, hovermode="closest")
    return fig


def fig_zones() -> go.Figure:
    """The 20 Sep run: one series, so no legend — the title names it."""
    zones = pd.DataFrame({"zone": ["Z1", "Z2", "Z3", "Z4", "Z5"],
                          "minutes": [1.1, 2.8, 21.9, 16.6, 16.2]})
    fig = go.Figure(go.Bar(x=zones["zone"], y=zones["minutes"], marker_color=V1,
                           marker_line_width=0, text=[f"{v:.1f}" for v in zones["minutes"]],
                           textposition="outside", cliponaxis=False))
    fig.update_layout(title="Real run, 20 Sep: 7.70 km, minutes by heart-rate zone",
                      yaxis_title="minutes", height=370, hovermode="closest")
    return fig


def fig_resting_hr() -> go.Figure:
    daily = q("""SELECT date, resting_hr FROM daily
                 WHERE date >= '2026-08-23' AND resting_hr IS NOT NULL ORDER BY date""", REAL_DB)
    fig = go.Figure()
    fig.add_scatter(x=daily["date"], y=daily["resting_hr"], mode="lines+markers",
                    name="resting HR", line=dict(color=V1, width=2), marker=dict(size=8))
    fig.add_vline(x="2026-09-20", line=dict(color=MUTED, dash="dot", width=1),
                  annotation_text="7.7 km run", annotation_position="top left")
    fig.update_layout(title="Resting heart rate, last 30 days (real watch data)",
                      yaxis_title="bpm", height=390, hovermode="x unified")
    return fig


def build_all() -> tuple[list[go.Figure], pd.DataFrame, pd.DataFrame]:
    runs, clf, b = runs_table(), classification_table(), bucket_b()
    figures = [fig_classifier(clf), fig_judge_per_case(b), fig_words(b),
               fig_latency(runs), fig_zones(), fig_resting_hr()]
    return figures, runs, clf


def write_html(path: Path | None = None) -> Path:
    path = path or REPO / "notebooks" / "eval_dashboard.html"
    figures, runs, clf = build_all()
    parts = [f.to_html(full_html=False, include_plotlyjs=("cdn" if i == 0 else False))
             for i, f in enumerate(figures)]
    tables = "".join(
        f"<h2>{name}</h2>" + frame.to_html(index=False, border=0, classes="t", justify="left")
        for name, frame in (("Runs on record", runs),
                            ("Escalation classifier, per run",
                             clf[["label", "esc_tp", "esc_fn", "esc_fp", "esc_tn", "esc_recall",
                                  "esc_precision", "esc_f1", "missed_red_flags",
                                  "tool_precision", "calls_per_case"]])))
    path.write_text(
        "<title>Wearable Coach eval dashboard</title>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<style>body{font:14px/1.6 Inter,-apple-system,Segoe UI,sans-serif;background:#fcfcfb;"
        "color:#0b0b0b;max-width:1120px;margin:0 auto;padding:28px 20px 70px}"
        "h1{font-size:27px;margin:0 0 4px}h2{font-size:17px;font-weight:500;margin:34px 0 10px}"
        "p.sub{color:#52514e;margin:0 0 26px}section{margin-bottom:30px}"
        "table.t{border-collapse:collapse;font-size:13px;width:100%}"
        "table.t th{text-align:left;color:#52514e;font-weight:500;border-bottom:1px solid #e6e5e0;padding:6px 9px}"
        "table.t td{border-bottom:1px solid #f0efea;padding:6px 9px;font-variant-numeric:tabular-nums}"
        "</style>"
        "<h1>Wearable Coach — evaluation dashboard</h1>"
        f"<p class=sub>{len(runs)} runs on record · built from evals.duckdb and wearable-real.duckdb</p>"
        + "".join(f"<section>{p}</section>" for p in parts) + tables)
    return path


# %% [markdown]
# ## Runs on record
# `harness` matters: `canvas` is the n8n agent, the demo's subject. `local` is
# the headless stand-in, which scores systematically higher — useful for
# iteration, never comparable to canvas numbers.

# %%
runs_table()

# %% [markdown]
# ## Safety as a classifier
# Each run is 30 binary predictions: 4 clinical cases that must escalate, 26
# that must not. Recall is the safety number; precision the usefulness one.

# %%
fig_classifier(classification_table()).show()

# %%
classification_table()[["label", "esc_tp", "esc_fn", "esc_fp", "esc_tn", "esc_recall",
                        "esc_precision", "missed_red_flags", "tool_precision", "calls_per_case"]]

# %% [markdown]
# ## Judged advice, case by case
# The same twelve questions under each prompt, so you can see where the gain
# came from — and B11, where v2 did worse.

# %%
fig_judge_per_case(bucket_b()).show()

# %% [markdown]
# ## Length: the counterintuitive result
# v2 halves the answer and scores higher, judged by a different provider's
# model. The length-bias claim, tested rather than asserted.

# %%
fig_words(bucket_b()).show()

# %%
fig_latency(runs_table()).show()

# %% [markdown]
# ## The other half: real watch data
# The demo runs on a calibrated fixture because the real export has no HRV.
# What the real data does have is daytime training.

# %%
fig_zones().show()

# %%
fig_resting_hr().show()

# %%
if __name__ == "__main__":
    print(f"wrote {write_html()}")
