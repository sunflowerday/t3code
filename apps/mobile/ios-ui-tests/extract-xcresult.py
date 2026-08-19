#!/usr/bin/env python3
"""Turn an xcresult into one JSON file of KUCA_RESULT rows + pass/fail."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=False, capture_output=True, text=True)


def load_summary(xcresult: Path) -> dict:
    new = run(
        [
            "xcrun",
            "xcresulttool",
            "get",
            "test-results",
            "summary",
            "--path",
            str(xcresult),
        ]
    )
    if new.returncode == 0 and new.stdout.strip():
        return json.loads(new.stdout)
    legacy = run(
        [
            "xcrun",
            "xcresulttool",
            "get",
            "--legacy",
            "--path",
            str(xcresult),
            "--format",
            "json",
        ]
    )
    if legacy.returncode != 0:
        raise SystemExit(
            "xcresulttool failed\n"
            f"new: {new.stderr.strip()}\n"
            f"legacy: {legacy.stderr.strip()}"
        )
    return json.loads(legacy.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("xcresult", type=Path)
    parser.add_argument("--out", type=Path, default=Path("/tmp/kuca-ui-result.json"))
    args = parser.parse_args()
    if not args.xcresult.exists():
        print(f"error: missing {args.xcresult}", file=sys.stderr)
        return 1
    summary = load_summary(args.xcresult)
    payload = {
        "xcresult": str(args.xcresult),
        "summary": summary,
    }
    args.out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
