"""Phase 0: inventory a Garmin export and map files to tables (SPEC §12).

    python -m loader.inventory raw/           # or raw/fixture

Prints one line per JSON file: record count, detected table, and the source
fields we would not map. Unclassified files are listed last -- that list is the
to-do for extending loader/fieldmap.py.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

from loader.discovery import classify, flatten, iter_records, json_files
from loader.fieldmap import SPECS, apply_spec


def inventory(root: Path) -> int:
    files = json_files(root)
    if not files:
        print(f"no JSON files under {root}", file=sys.stderr)
        return 1

    by_table: Counter[str] = Counter()
    unclassified: list[tuple[str, int]] = []

    print(f"{'records':>8}  {'table':<13} file")
    print("-" * 88)
    for path in files:
        table = classify(path, root)
        records = list(iter_records(path))
        rel = path.relative_to(root)
        if table is None:
            unclassified.append((str(rel), len(records)))
            continue
        by_table[table] += len(records)
        unmapped: Counter[str] = Counter()
        spec = SPECS.get(table)
        if spec:
            for record in records[:200]:
                _, missing = apply_spec(flatten(record), spec)
                unmapped.update(missing)
        print(f"{len(records):>8}  {table:<13} {rel}")
        if unmapped:
            top = ", ".join(k for k, _ in unmapped.most_common(12))
            print(f"{'':>8}  {'':<13}   unmapped: {top}")

    print("\nrecords per table")
    for table, count in sorted(by_table.items()):
        print(f"  {table:<13} {count}")

    if unclassified:
        print("\nunclassified (extend loader/discovery.FILE_PATTERNS if these matter)")
        for name, count in unclassified:
            print(f"  {count:>7}  {name}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default="raw", type=Path)
    args = parser.parse_args()
    return inventory(args.root)


if __name__ == "__main__":
    raise SystemExit(main())
