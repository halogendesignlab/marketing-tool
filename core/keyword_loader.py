"""keyword_loader.py — Load and parse keyword research CSVs for a client.

CSVs live at: clients/<client_id>/keywords/*.csv
Expected columns: Keyword, Volume, KD, Intent, Content Type, Priority, Notes
Rows that are section headers or strategy notes are automatically skipped.
"""

import csv
import re
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

CLIENTS_DIR = Path(__file__).parent.parent / "clients"

# Rows whose Keyword field matches these patterns are skipped (headers/notes)
_SKIP_PATTERNS = [
    re.compile(r"^STRATEGY NOTES", re.IGNORECASE),
    re.compile(r"^LOCAL\s*/\s*GEO", re.IGNORECASE),
    re.compile(r"^NATIONAL", re.IGNORECASE),
    re.compile(r"^INFORMATIONAL", re.IGNORECASE),
    re.compile(r"^SECTION", re.IGNORECASE),
]

# Volume strings like "30+30+10" → sum → 70
def _parse_volume(raw: str) -> int:
    raw = raw.strip()
    if not raw or raw.upper() in ("N/A", "-", ""):
        return 0
    try:
        # Handle additive volumes like "30+30+10"
        if "+" in raw:
            return sum(int(x.strip()) for x in raw.split("+") if x.strip().isdigit())
        return int(re.sub(r"[^\d]", "", raw) or "0")
    except (ValueError, TypeError):
        return 0


def _is_skip_row(keyword: str) -> bool:
    """Return True if this row is a section header or strategy note."""
    if not keyword or len(keyword) > 120:
        return True
    return any(p.match(keyword) for p in _SKIP_PATTERNS)


def load_keywords(client_id: str) -> list[dict]:
    """
    Load all keyword rows from clients/<client_id>/keywords/*.csv.
    Returns list of dicts with keys:
        keyword, volume, kd, intent, content_type, priority, notes
    Sorted by priority (High → Med → Low) then volume descending.
    """
    keywords_dir = CLIENTS_DIR / client_id / "keywords"
    if not keywords_dir.exists():
        return []

    rows = []
    for csv_path in sorted(keywords_dir.glob("*.csv")):
        try:
            with open(csv_path, newline="", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Normalize column names (strip whitespace)
                    row = {k.strip(): v.strip() for k, v in row.items() if k}
                    keyword = row.get("Keyword", "").strip()
                    if _is_skip_row(keyword):
                        continue
                    rows.append({
                        "keyword": keyword,
                        "volume": _parse_volume(row.get("Volume", "")),
                        "kd": row.get("KD", "").strip() or None,
                        "intent": row.get("Intent", "").strip(),
                        "content_type": row.get("Content Type", "").strip(),
                        "priority": row.get("Priority", "").strip(),
                        "notes": row.get("Notes", "").strip(),
                    })
        except Exception as e:
            logger.warning(f"[{client_id}] Failed to load keyword file {csv_path.name}: {e}")

    # Sort: High > Med > Low, then by volume desc
    priority_order = {"High": 0, "Med": 1, "Low": 2}
    rows.sort(key=lambda r: (priority_order.get(r["priority"], 3), -r["volume"]))
    return rows


# Low-priority terms are kept out of the blog tier. The research usually flags them
# as ambiguous or unvalidated, yet their raw volume lets them outrank real topics.
BLOG_TIER_PRIORITIES = {"High", "Med"}


def get_blog_keywords(client_id: str, max_keywords: int = 10) -> list[dict]:
    """
    Return keywords suited for blog/content generation, in priority order:
    1. Blog Post / Informational keywords that are High or Med priority
    2. High-priority Service Page keywords (great topic material even if
       the keyword research labels them as service pages — a blog post on
       'restaurant construction' still builds authority for that term)
    3. Everything else, including anything demoted from tier 1, by priority then volume

    Rows arrive from load_keywords() already sorted by priority then volume,
    so each tier preserves that ordering.
    """
    all_kws = load_keywords(client_id)
    if not all_kws:
        return []

    # Tier 1: explicitly blog/informational, and worth targeting
    explicit = [
        k for k in all_kws
        if ("blog" in k["content_type"].lower() or "informational" in k["intent"].lower())
        and k["priority"] in BLOG_TIER_PRIORITIES
    ]

    # Tier 2: high-priority service page keywords not already in tier 1
    explicit_set = {k["keyword"] for k in explicit}
    service_high = [
        k for k in all_kws
        if k not in explicit
        and k["keyword"] not in explicit_set
        and k["priority"] == "High"
        and "service" in k["content_type"].lower()
        and "/" not in k["keyword"]
    ]

    combined = explicit + service_high
    # If we still don't have enough, pad with remaining keywords
    if len(combined) < max_keywords:
        seen = {k["keyword"] for k in combined}
        rest = [k for k in all_kws if k["keyword"] not in seen and "/" not in k["keyword"]]
        combined += rest

    return combined[:max_keywords]


def get_all_keywords_summary(client_id: str) -> str:
    """
    Return a compact text summary of all keywords for use in AI prompts.
    """
    all_kws = load_keywords(client_id)
    if not all_kws:
        return ""

    lines = ["Target keywords (from keyword research):"]
    for k in all_kws:
        vol = f"vol:{k['volume']}" if k["volume"] else ""
        priority = k["priority"]
        intent = k["intent"]
        parts = [f"- {k['keyword']}"]
        if priority:
            parts.append(f"[{priority}]")
        if vol:
            parts.append(f"({vol})")
        if intent:
            parts.append(f"— {intent}")
        lines.append(" ".join(parts))

    return "\n".join(lines)
