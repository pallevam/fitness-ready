"""Garmin Connect API client and pullers.

Brings forward the "daily refresh via Garmin Connect API" item from SPEC §2
Phase 2, without adding a second path into DuckDB: the fetcher writes JSON files
that loader/ reads, exactly as it reads the account export (SPEC §6.1).
"""
