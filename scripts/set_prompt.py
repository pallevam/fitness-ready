#!/usr/bin/env python3
"""Swap the live agent's system prompt between v1 and v2, on stage, in seconds.

    python3 scripts/set_prompt.py v1      # the naive baseline
    python3 scripts/set_prompt.py v2      # the fixed prompt
    python3 scripts/set_prompt.py --show  # which one is live right now

Reads prompts/system_v{1,2}.md, drops the leading markdown title and anything
after the repo-notes divider (those notes name the expected failures, and a model
that reads them stops making them), and writes the rest into the AI Agent node's
systemMessage as an n8n expression so `{{ $json.as_of_date }}` still resolves.

Nothing else in the workflow is touched: tools, credentials, memory and
returnIntermediateSteps all survive, because the node is patched in place rather
than re-imported from the repo copy.

Reload the n8n browser tab after switching, or an open tab will save the old
prompt back over this one.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKFLOW = "workflow_agent"
CONTAINER_PATH = "/tmp/agent_prompt_switch.json"
MARKERS = {"v1": "Be helpful and encouraging", "v2": "One action, one sentence"}


def compose(*args: str, capture: bool = True) -> str:
    result = subprocess.run(
        ["docker", "compose", *args], cwd=REPO, capture_output=capture, text=True, check=True
    )
    return result.stdout if capture else ""


def live_workflows() -> list[dict]:
    raw = compose("exec", "-T", "n8n", "n8n", "export:workflow", "--all")
    return json.loads(raw[raw.index("[") :])


def agent_node(workflow: dict) -> dict:
    for node in workflow["nodes"]:
        if node["type"].endswith(".agent"):
            return node
    raise SystemExit(f"no AI Agent node in {workflow['name']}")


def which(system_message: str) -> str:
    for version, marker in MARKERS.items():
        if marker in system_message:
            return version
    return "unknown"


def prompt_body(version: str) -> str:
    text = (REPO / "prompts" / f"system_{version}.md").read_text()
    # Everything after a horizontal rule is repo commentary, not prompt.
    text = text.split("\n---\n")[0]
    lines = [line for line in text.splitlines() if not line.startswith("# Wearable Coach")]
    body = "\n".join(lines).strip()
    if version == "v1":
        # v1's trailing paragraph lists the failures the demo wants to happen.
        cut = body.find("This prompt is the \"before\"")
        if cut != -1:
            body = body[:cut].strip()
    if not body:
        raise SystemExit(f"prompts/system_{version}.md looks empty")
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("version", nargs="?", choices=("v1", "v2"))
    parser.add_argument("--show", action="store_true", help="print the live prompt version and exit")
    args = parser.parse_args()

    workflows = live_workflows()
    workflow = next((w for w in workflows if w["name"] == WORKFLOW), None)
    if workflow is None:
        raise SystemExit(f"{WORKFLOW} is not in this n8n instance")
    node = agent_node(workflow)
    current = node["parameters"]["options"]["systemMessage"]

    if args.show or not args.version:
        print(f"{WORKFLOW} is running {which(current)} ({len(current.split())} words)")
        return 0

    body = prompt_body(args.version)
    node["parameters"]["options"]["systemMessage"] = "=" + body

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(workflow, handle, indent=2)
        local = handle.name
    # `docker compose cp` preserves the mode, and n8n runs as uid 1000: a 0600
    # temp file lands unreadable and the import fails with EACCES.
    Path(local).chmod(0o644)
    compose("cp", local, f"n8n:{CONTAINER_PATH}")
    compose("exec", "-T", "n8n", "n8n", "import:workflow", f"--input={CONTAINER_PATH}")
    Path(local).unlink(missing_ok=True)

    live = agent_node(next(w for w in live_workflows() if w["name"] == WORKFLOW))
    got = which(live["parameters"]["options"]["systemMessage"])
    options = live["parameters"]["options"]
    if got != args.version:
        print(f"switch failed: live prompt reads as {got}", file=sys.stderr)
        return 1
    print(f"{WORKFLOW} now runs {got} ({len(options['systemMessage'].split())} words); "
          f"returnIntermediateSteps={options.get('returnIntermediateSteps')}")
    print("Reload the n8n tab before running anything.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
