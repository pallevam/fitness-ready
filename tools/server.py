"""The agent's only access to the data: five named tools over HTTP (SPEC §7).

    uvicorn tools.server:app --port 8000

n8n calls these with HTTP Request tool nodes. There is deliberately no
free-form SQL endpoint in Phase 1 (SPEC §11 open decision 1): named tools make
"did the agent call the right tool" a clean pass/fail for the eval harness.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Any

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Query

from db import connect, db_path
from tools import queries
from tools.derived import MAX_RANGE_DAYS

_connection: duckdb.DuckDBPyConnection | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """One read-only connection for the process; each request gets its own cursor."""
    global _connection
    _connection = connect(read_only=True)
    try:
        yield
    finally:
        _connection.close()
        _connection = None


app = FastAPI(
    title="Wearable Coach tools",
    version="0.1.0",
    summary="Named, read-only tools over a Garmin-derived DuckDB.",
    lifespan=lifespan,
)


def get_conn() -> duckdb.DuckDBPyConnection:
    if _connection is None:  # pragma: no cover - only if lifespan didn't run
        raise HTTPException(
            status_code=503,
            detail="The database is not open yet. This is a server problem, not a bad "
                   "request: do not retry this call, and tell the user the data is unavailable.",
        )
    return _connection.cursor()


def _validate_range(start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise HTTPException(
            status_code=422,
            detail=(
                f"end_date ({end_date}) is before start_date ({start_date}). "
                "Swap them and call again."
            ),
        )
    span = (end_date - start_date).days + 1
    if span > MAX_RANGE_DAYS:
        # Error bodies are read by the agent, not a developer, so they name the
        # limit *and* the corrected call. Without the suggestion the model tends
        # to retry the identical request (observed in Langfuse, 2026-09-15).
        earliest = end_date - timedelta(days=MAX_RANGE_DAYS - 1)
        raise HTTPException(
            status_code=422,
            detail=(
                f"Requested {span} days; the cap is {MAX_RANGE_DAYS} days inclusive of both "
                f"endpoints. Retry with start_date={earliest.isoformat()} for the widest "
                f"allowed window ending {end_date.isoformat()}, or split the range across "
                "several calls."
            ),
        )


@app.get("/health", summary="Liveness plus data coverage")
def health(conn: duckdb.DuckDBPyConnection = Depends(get_conn)) -> dict[str, Any]:
    tables = ("daily", "sleep", "hrv", "activities", "user_metrics")
    counts = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}
    latest = conn.execute("SELECT max(date) FROM daily").fetchone()[0]
    return {
        "status": "ok",
        "db": str(db_path()),
        "rows": counts,
        "latest_date": latest.isoformat() if latest else None,
    }


@app.get("/tools/get_daily_metrics", summary="Daily wellness rows for a date range")
def get_daily_metrics(
    start_date: date,
    end_date: date,
    conn: duckdb.DuckDBPyConnection = Depends(get_conn),
) -> dict[str, Any]:
    _validate_range(start_date, end_date)
    return queries.get_daily_metrics(conn, start_date, end_date)


@app.get("/tools/get_sleep", summary="Nightly sleep rows, including the validation flag")
def get_sleep(
    start_date: date,
    end_date: date,
    conn: duckdb.DuckDBPyConnection = Depends(get_conn),
) -> dict[str, Any]:
    _validate_range(start_date, end_date)
    return queries.get_sleep(conn, start_date, end_date)


@app.get("/tools/get_hrv_trend", summary="Nightly HRV with 7- and 60-day means and the baseline band")
def get_hrv_trend(
    days: int = Query(default=30, ge=1, le=MAX_RANGE_DAYS),
    as_of: date | None = None,
    conn: duckdb.DuckDBPyConnection = Depends(get_conn),
) -> dict[str, Any]:
    return queries.get_hrv_trend(conn, days=days, as_of=as_of)


@app.get("/tools/list_activities", summary="Activities in a date range, flagged hard/easy")
def list_activities(
    start_date: date,
    end_date: date,
    type: str | None = Query(default=None, description="running | walking | cycling | ..."),
    conn: duckdb.DuckDBPyConnection = Depends(get_conn),
) -> dict[str, Any]:
    _validate_range(start_date, end_date)
    return queries.list_activities(conn, start_date, end_date, activity_type=type)


@app.get("/tools/get_readiness_inputs", summary="Every input the readiness rubric needs, for one date")
def get_readiness_inputs(
    date_: date | None = Query(default=None, alias="date"),
    conn: duckdb.DuckDBPyConnection = Depends(get_conn),
) -> dict[str, Any]:
    return queries.get_readiness_inputs(conn, as_of=date_)


def main() -> None:  # pragma: no cover - convenience entrypoint
    import uvicorn

    uvicorn.run(
        "tools.server:app",
        host=os.environ.get("TOOLS_HOST", "127.0.0.1"),
        port=int(os.environ.get("TOOLS_PORT", "8000")),
        reload=bool(os.environ.get("TOOLS_RELOAD")),
    )


if __name__ == "__main__":  # pragma: no cover
    main()
