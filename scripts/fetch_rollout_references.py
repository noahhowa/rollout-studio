#!/usr/bin/env python3
"""Fetch the two published rollout fixtures used by scripts/eval-rollout.js."""
import json
from pathlib import Path
from fetch_test_sets import get, save_jpeg

ROOT = Path(__file__).resolve().parent.parent


def main():
    references = json.loads((ROOT / 'eval/rollout-cases.json').read_text())['references']
    failed = False
    for reference in references:
        path = ROOT / reference['file']
        if path.exists():
            print(f"{reference['id']}: already available")
            continue
        try:
            data = get(reference['url'], tries=2)
            path.parent.mkdir(parents=True, exist_ok=True)
            save_jpeg(data, path)
            print(f"{reference['id']}: saved {path.relative_to(ROOT)}")
        except Exception as error:
            print(f"{reference['id']}: unavailable ({error})")
            failed = True
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
