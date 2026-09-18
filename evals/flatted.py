"""Decode n8n's `flatted` execution data (SPEC §9.3 tooling).

n8n stores `execution_data.data` as a JSON array in the `flatted` format: the
graph is flattened into a list, and every **string** inside a container is an
index into that list. Numbers, booleans and nulls are stored inline.

That asymmetry is the whole trick, and getting it wrong is silent: resolve an
index, get the string `"5"` back, resolve *that* as an index too, and a case's
`expected_answer` of "5" turns into whatever object happens to sit at position
5 -- a corruption that reads as real data. So a string is resolved exactly once
and never again.
"""

from __future__ import annotations

import json
from typing import Any


def _resolve(value: Any, pool: list[Any], seen: dict[int, Any]) -> Any:
    if isinstance(value, str):
        # A string in a container is an index; the value it points at may itself
        # be a container, but if it is a string that string is the final value.
        try:
            index = int(value)
        except ValueError:
            return value  # not an index at all: keep it (defensive)
        if not 0 <= index < len(pool):
            return value
        return _expand(index, pool, seen)
    return value


def _expand(index: int, pool: list[Any], seen: dict[int, Any]) -> Any:
    if index in seen:
        return seen[index]  # already built, and this also breaks reference cycles
    node = pool[index]
    if isinstance(node, dict):
        built: Any = {}
        seen[index] = built
        for key, child in node.items():
            built[key] = _resolve(child, pool, seen)
        return built
    if isinstance(node, list):
        built = []
        seen[index] = built
        for child in node:
            built.append(_resolve(child, pool, seen))
        return built
    seen[index] = node
    return node


def loads(text: str) -> Any:
    """Parse one flatted payload into ordinary Python objects."""
    pool = json.loads(text)
    if not isinstance(pool, list) or not pool:
        return pool
    return _expand(0, pool, {})
