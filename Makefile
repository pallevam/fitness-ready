.PHONY: help fixture load inventory serve test evals stack clean

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

fixture:   ## Generate the synthetic Garmin export in raw/fixture
	python -m loader.make_fixture --out raw/fixture

inventory: ## Phase 0: list export files and their field mapping
	python -m loader.inventory raw/fixture

load:      ## Phase 1: build wearable.duckdb from the fixture (use raw/ for the real export)
	python -m loader.load_garmin raw/fixture

serve:     ## Phase 2: run the tools server on :8000
	python -m tools.server

test:      ## Run the suite
	python -m pytest

evals:     ## Phase 4: recompute bucket A ground truth into evals/dataset.csv
	python -m evals.ground_truth --write

stack:     ## Phase 3+: n8n + Langfuse + tools in Docker
	docker compose up -d

clean:     ## Drop the database (raw data is untouched)
	rm -f wearable.duckdb wearable.duckdb.wal
