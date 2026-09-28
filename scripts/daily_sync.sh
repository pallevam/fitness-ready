#!/bin/zsh
# Morning Garmin sync, run by launchd (~/Library/LaunchAgents/com.fitness-ready.daily-sync.plist).
# Pulls the last 30 days (already-final days are reused) into wearable-real.duckdb.
# launchd starts with a bare environment, so the interpreter path is absolute.
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON=/Users/vamsikpalle/.pyenv/versions/3.12.8/bin/python
echo "=== $(date '+%F %T') sync start"
$PYTHON -m fetcher.pull
$PYTHON -m loader.load_garmin raw/api --db wearable-real.duckdb
$PYTHON -c "import duckdb; c=duckdb.connect('wearable-real.duckdb', read_only=True); print('latest sleep:', c.execute('select date, total_min, sleep_score from sleep order by date desc limit 1').fetchone())"
echo "=== $(date '+%F %T') sync done"
