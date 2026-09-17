#!/usr/bin/env python3
"""Load evals/dataset.csv into an n8n data table via the public REST API.

Why this exists: the Evaluation Trigger node in n8n 2.38 can read its dataset
from an n8n **data table** instead of a Google Sheet, which removes the Google
account from the loop entirely. n8n has no CLI command that creates a data
table, but the public API does (verified against the installed source in the
wc-n8n container, n8n 2.38.7):

    GET    /api/v1/data-tables                  scope dataTable:list
    POST   /api/v1/data-tables                  scope dataTable:create
    GET    /api/v1/data-tables/{id}/rows         scope dataTableRow:read
    POST   /api/v1/data-tables/{id}/rows         scope dataTableRow:create
    POST   /api/v1/data-tables/{id}/rows/delete  scope dataTableRow:delete

An owner API key carries every one of those scopes (OWNER_API_KEY_SCOPES in
@n8n/permissions), so no license or env flag is needed -- only a key:

    n8n UI -> your avatar (bottom left) -> Settings -> n8n API
           -> "Create an API key" -> label it, scopes "All", copy the value

Then:

    export N8N_API_KEY='<paste>'
    python3 scripts/load_eval_dataset.py            # create + load 30 rows
    python3 scripts/load_eval_dataset.py --dry-run  # no key needed, no writes

IMPORTANT -- the `id` column cannot be used as-is. Every n8n data table owns
three system columns (`id`, `createdAt`, `updatedAt`), and
DataTableRepository.createDataTable throws
DataTableSystemColumnNameConflictError for any user column whose name matches
one of them case-insensitively. So the dataset's `id` column is loaded as
`case_id` (override with --id-column). The other six names are used verbatim.
n8n/workflow_eval.json never references the row's id, so nothing downstream
breaks; only the node note in the Evaluation Trigger is now slightly stale.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = REPO_ROOT / "evals" / "dataset.csv"
DEFAULT_BASE_URL = "http://localhost:5678"
DEFAULT_TABLE = "eval_dataset"

# Names n8n reserves on every data table; a user column may not use them.
SYSTEM_COLUMNS = {"id", "createdat", "updatedat", "dryrunstate"}
EXPECTED_HEADER = [
    "id",
    "bucket",
    "question",
    "as_of_date",
    "expected_tool",
    "expected_answer",
    "rubric_notes",
]


class ApiError(RuntimeError):
    pass


def request(base_url: str, api_key: str, method: str, path: str, body=None, query=None):
    url = base_url.rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-N8N-API-KEY", api_key)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        if exc.code == 401:
            raise ApiError(
                "401 from the n8n API. The X-N8N-API-KEY is missing, wrong, or expired. "
                "Create one in Settings -> n8n API."
            ) from exc
        raise ApiError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"cannot reach {url}: {exc.reason}") from exc


def read_rows(csv_path: Path, id_column: str) -> list[dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames or []
        if header != EXPECTED_HEADER:
            raise SystemExit(
                f"{csv_path} header is {header}\nexpected {EXPECTED_HEADER}"
            )
        rows = [dict(r) for r in reader]

    out = []
    for row in rows:
        renamed = {(id_column if k == "id" else k): ("" if v is None else v) for k, v in row.items()}
        out.append(renamed)
    return out


def column_names(id_column: str) -> list[str]:
    return [id_column if c == "id" else c for c in EXPECTED_HEADER]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--base-url", default=os.environ.get("N8N_BASE_URL", DEFAULT_BASE_URL))
    ap.add_argument("--table", default=DEFAULT_TABLE)
    ap.add_argument("--id-column", default="case_id", help="name to load the CSV's `id` column under (default: case_id)")
    ap.add_argument("--project-id", default=None, help="team project id; default is the key owner's personal project")
    ap.add_argument("--replace", action="store_true", help="clear existing rows before inserting")
    ap.add_argument("--dry-run", action="store_true", help="validate and print the payload; no key and no network needed")
    args = ap.parse_args()

    if args.id_column.lower() in SYSTEM_COLUMNS:
        raise SystemExit(
            f"--id-column {args.id_column!r} collides with an n8n system column "
            f"({', '.join(sorted(SYSTEM_COLUMNS))}); pick another name, e.g. case_id"
        )

    cols = column_names(args.id_column)
    rows = read_rows(args.csv, args.id_column)
    buckets: dict[str, int] = {}
    for r in rows:
        buckets[r.get("bucket", "?")] = buckets.get(r.get("bucket", "?"), 0) + 1

    create_body = {
        "name": args.table,
        "columns": [{"name": c, "type": "string"} for c in cols],
    }
    if args.project_id:
        create_body["projectId"] = args.project_id

    print(f"csv          : {args.csv}")
    print(f"rows         : {len(rows)}  buckets {dict(sorted(buckets.items()))}")
    print(f"as_of_date   : {sorted({r['as_of_date'] for r in rows})}")
    print(f"table        : {args.table} @ {args.base_url}")
    print(f"columns      : {cols}")

    if args.dry_run:
        print("\n--dry-run: POST /api/v1/data-tables body")
        print(json.dumps(create_body, indent=2))
        print("\n--dry-run: POST /api/v1/data-tables/{id}/rows body (first row of 30 shown)")
        print(json.dumps({"data": rows[:1], "returnType": "count"}, indent=2))
        return 0

    api_key = os.environ.get("N8N_API_KEY", "").strip()
    if not api_key:
        raise SystemExit(
            "N8N_API_KEY is not set. Create a key in the n8n UI "
            "(Settings -> n8n API -> Create an API key) and `export N8N_API_KEY=...`."
        )

    existing = request(
        args.base_url, api_key, "GET", "/api/v1/data-tables",
        query={"filter": json.dumps({"name": args.table})},
    )
    matches = [t for t in (existing or {}).get("data", []) if t.get("name") == args.table]

    if matches:
        table = matches[0]
        print(f"\nfound existing data table {args.table} (id {table['id']})")
        have = {c["name"] for c in table.get("columns", [])}
        missing = [c for c in cols if c not in have]
        if missing:
            raise SystemExit(
                f"existing table {args.table} is missing columns {missing}; "
                "delete it in the UI and rerun, or point --table at a new name"
            )
        if args.replace:
            request(args.base_url, api_key, "DELETE", f"/api/v1/data-tables/{table['id']}/rows/clear")
            print("cleared existing rows")
        else:
            present = request(
                args.base_url, api_key, "GET", f"/api/v1/data-tables/{table['id']}/rows",
                query={"limit": "1"},
            )
            if (present or {}).get("data"):
                raise SystemExit(
                    f"{args.table} already has rows; inserting would duplicate them. "
                    "Rerun with --replace to clear first."
                )
    else:
        table = request(args.base_url, api_key, "POST", "/api/v1/data-tables", body=create_body)
        print(f"\ncreated data table {args.table} (id {table['id']})")

    inserted = request(
        args.base_url, api_key, "POST", f"/api/v1/data-tables/{table['id']}/rows",
        body={"data": rows, "returnType": "count"},
    )
    print(f"insert response: {inserted}")

    check = request(
        args.base_url, api_key, "GET", f"/api/v1/data-tables/{table['id']}/rows",
        query={"limit": "250"},
    )
    back = (check or {}).get("data", [])
    print(f"read-back: {len(back)} rows in {args.table}")
    if back:
        print("first row: " + json.dumps(back[0]))
    print("\nVerify in the UI: Overview -> Data tables -> " + args.table)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ApiError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
