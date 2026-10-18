#!/usr/bin/env python3
"""Rank book title candidates using the bundled 100-point rubric.

Usage:
    python scripts/rank_candidates.py candidates.json
    python scripts/rank_candidates.py candidates.json --output ranking.md

The input may be a JSON list or an object with a "candidates" list.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

MAX_SCORES = {
    "desire": 20,
    "clarity": 15,
    "differentiation": 15,
    "specificity": 10,
    "memorability": 10,
    "credibility": 10,
    "audience_fit": 10,
    "complementarity": 5,
    "marketplace": 5,
}


def load_candidates(path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Input file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc

    if isinstance(data, dict):
        data = data.get("candidates")
    if not isinstance(data, list) or not data:
        raise ValueError('Input must be a non-empty list or an object with a non-empty "candidates" list.')
    if not all(isinstance(item, dict) for item in data):
        raise ValueError("Every candidate must be a JSON object.")
    return data


def validate_and_score(candidate: dict[str, Any], index: int) -> dict[str, Any]:
    title = candidate.get("title")
    subtitle = candidate.get("subtitle", "")
    scores = candidate.get("scores")
    penalties = candidate.get("penalties", [])

    if not isinstance(title, str) or not title.strip():
        raise ValueError(f"Candidate {index}: title must be a non-empty string.")
    if not isinstance(subtitle, str):
        raise ValueError(f"Candidate {index}: subtitle must be a string.")
    if not isinstance(scores, dict):
        raise ValueError(f"Candidate {index} ({title}): scores must be an object.")

    missing = [key for key in MAX_SCORES if key not in scores]
    extra = [key for key in scores if key not in MAX_SCORES]
    if missing:
        raise ValueError(f"Candidate {index} ({title}): missing score keys: {', '.join(missing)}")
    if extra:
        raise ValueError(f"Candidate {index} ({title}): unknown score keys: {', '.join(extra)}")

    numeric_scores: dict[str, float] = {}
    for key, maximum in MAX_SCORES.items():
        value = scores[key]
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"Candidate {index} ({title}): score '{key}' must be numeric.")
        if value < 0 or value > maximum:
            raise ValueError(
                f"Candidate {index} ({title}): score '{key}' must be between 0 and {maximum}."
            )
        numeric_scores[key] = float(value)

    if not isinstance(penalties, list):
        raise ValueError(f"Candidate {index} ({title}): penalties must be a list.")

    penalty_total = 0.0
    penalty_notes: list[str] = []
    for penalty_index, penalty in enumerate(penalties, start=1):
        if not isinstance(penalty, dict):
            raise ValueError(
                f"Candidate {index} ({title}), penalty {penalty_index}: penalty must be an object."
            )
        reason = penalty.get("reason", "Unspecified penalty")
        points = penalty.get("points")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(
                f"Candidate {index} ({title}), penalty {penalty_index}: reason must be a non-empty string."
            )
        if not isinstance(points, (int, float)) or isinstance(points, bool):
            raise ValueError(
                f"Candidate {index} ({title}), penalty {penalty_index}: points must be numeric."
            )
        if points > 0:
            raise ValueError(
                f"Candidate {index} ({title}), penalty {penalty_index}: points must be zero or negative."
            )
        penalty_total += float(points)
        penalty_notes.append(f"{reason} ({points:g})")

    base_score = sum(numeric_scores.values())
    final_score = max(0.0, min(100.0, base_score + penalty_total))

    return {
        "title": title.strip(),
        "subtitle": subtitle.strip(),
        "scores": numeric_scores,
        "base_score": base_score,
        "penalty_total": penalty_total,
        "penalty_notes": penalty_notes,
        "final_score": final_score,
    }


def fmt_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:.1f}"


def render_markdown(rows: list[dict[str, Any]]) -> str:
    header = (
        "| Rank | Title | Desire | Clarity | Difference | Specificity | Memory | "
        "Credibility | Fit | Pair | Market | Penalty | Final |\n"
        "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
    )
    lines = [header]
    for rank, row in enumerate(rows, start=1):
        scores = row["scores"]
        full_title = row["title"]
        if row["subtitle"]:
            full_title += f": {row['subtitle']}"
        full_title = full_title.replace("|", "\\|")
        lines.append(
            "| {rank} | {title} | {desire} | {clarity} | {difference} | {specificity} | "
            "{memory} | {credibility} | {fit} | {pair} | {market} | {penalty} | **{final}** |".format(
                rank=rank,
                title=full_title,
                desire=fmt_number(scores["desire"]),
                clarity=fmt_number(scores["clarity"]),
                difference=fmt_number(scores["differentiation"]),
                specificity=fmt_number(scores["specificity"]),
                memory=fmt_number(scores["memorability"]),
                credibility=fmt_number(scores["credibility"]),
                fit=fmt_number(scores["audience_fit"]),
                pair=fmt_number(scores["complementarity"]),
                market=fmt_number(scores["marketplace"]),
                penalty=fmt_number(row["penalty_total"]),
                final=fmt_number(row["final_score"]),
            )
        )

    penalty_rows = [row for row in rows if row["penalty_notes"]]
    if penalty_rows:
        lines.extend(["", "## Penalties"])
        for row in penalty_rows:
            lines.append(f"- **{row['title']}**: " + "; ".join(row["penalty_notes"]))

    lines.extend(
        [
            "",
            "> Scores structure judgment but do not replace cold-reader research, collision checks, or market testing.",
        ]
    )
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rank book title candidates using a 100-point rubric.")
    parser.add_argument("input", type=Path, help="Path to candidate-score JSON")
    parser.add_argument("--output", type=Path, help="Optional Markdown output path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        candidates = load_candidates(args.input)
        rows = [validate_and_score(candidate, index) for index, candidate in enumerate(candidates, start=1)]
        rows.sort(key=lambda row: (row["final_score"], row["base_score"]), reverse=True)
        markdown = render_markdown(rows)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(markdown, encoding="utf-8")
            print(f"Wrote ranking to {args.output}")
        else:
            print(markdown, end="")
        return 0
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
