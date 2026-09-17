# Wearable Coach

A coach that reads your wearable data, answers questions grounded in the
numbers, and is explicit that those numbers are approximations.

Consumer wearables give figures that are roughly right and occasionally wrong.
Most apps present them as exact. This one reasons over trends, respects the
device's own data-quality flags, and says what it does not know. `SPEC.md` is
the source of truth; this file is how to run it.

## Layout

```
loader/   Garmin export -> DuckDB       (Phase 0-1)
tools/    five named HTTP tools         (Phase 2)
evals/    dataset, ground truth, judge  (Phase 4)
prompts/  system_v1 (naive) and v2      (Phase 6)
n8n/      build sheet for the canvas    (Phase 3, 5)
tests/    the definitions in SPEC §6.3, the loader, the tool contracts, the dataset
```

## Quick start (no Garmin export needed)

```bash
pip install -e ".[dev]"
make fixture     # synthetic export, calibrated to the real training profile
make load        # -> wearable.duckdb
make test
make serve       # http://localhost:8000/docs
```

```bash
curl 'localhost:8000/tools/get_readiness_inputs?date=2026-09-13'
```

## Two databases, on purpose

`wearable.duckdb` is built from the fixture and is what the tools server, n8n and
the eval dataset point at. `wearable-real.duckdb` holds the real account export.
They are kept apart because the real data cannot support the readiness rubric —
see the implementation note in `SPEC.md` — and because mixing synthetic and real
rows in one table would make every eval answer unexplainable.

```bash
make load        # fixture   -> wearable.duckdb
make load-real   # export    -> wearable-real.duckdb
WEARABLE_DB=wearable-real.duckdb make serve   # point the tools at real data
```

## With the real export

1. garmin.com → Account → Data Management → Export Your Data. The zip arrives by
   email; unzip it into `raw/`.
2. `python -m loader.inventory raw/` — check every file maps to a table and read
   the unmapped-field list. Extend `loader/discovery.py` (patterns) or
   `loader/fieldmap.py` (columns) until nothing important is unmapped.
3. `make load-real` — idempotent; re-running a later export converges rather
   than duplicating.
4. `python -m evals.ground_truth --write` — bucket A answers are derived from
   the database, never hand-typed.

### Or via the Connect API

```bash
pip install -e ".[api]"
make probe DATE=2026-09-16   # one day of raw responses, to inspect field names
make load-api                # pull the last 30 days, load into wearable-real.duckdb
make pull START=2026-06-01 END=2026-09-16   # a specific range (at most 366 days)
```

The first login asks for your Garmin password (and an MFA code, if enabled) in
the terminal; later runs reuse the token cached in `~/.garminconnect`. Re-running
is cheap: only days not yet on disk, plus the last two, are fetched. API and
export data for the same day or activity converge on the same row.

`raw/` and `*.duckdb` are gitignored. This is personal health data; keep it that
way.

## The agent and the eval loop

`docker compose up -d` brings up the tools server, n8n (<http://localhost:5678>)
and Langfuse (<http://localhost:3000>). Build the two workflows from
`n8n/README.md`, then run the dataset through the Evaluations tab. The iteration
arc — v1, diagnose from traces, v2, compare — is in `docs/demo_script.md`.

## Design decisions worth knowing

- **Five named tools, no free-form SQL.** "Did it call the right tool" stays a
  clean pass/fail, and raw data stays behind a guardrail (SPEC §7, §11).
- **The derived definitions live in one module.** `tools/derived.py` defines
  hard session, resting-HR delta, HRV vs baseline and sleep trust once, as a SQL
  fragment and as a Python predicate, and the tests assert the two agree.
- **`get_readiness_inputs` anchors to 18:00 on the as-of date.** Evals pin
  `as_of_date`, so "hours since the last hard session" must not move with the
  wall clock.
- **No Training Readiness or Training Status.** The vivoactive 5 does not
  produce them. The agent reconstructs a readiness call from raw inputs with a
  visible rubric, which is also what makes it evaluable.
- **Not medical advice.** Red-flag inputs are escalated, not answered.
