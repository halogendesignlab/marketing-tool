"""prune_stale_serp.py — Remove map-pack results that were never really measured.

Local Falcon returns its newest scan per keyword whether or not that scan is
recent. The monthly job used to store whatever came back under the current
month, so a keyword that stopped being scanned had one old result filed under
every subsequent month — and the report compared it against itself as "no
change". core.report_generator now refuses to file a scan under a month it was
not taken in; this clears out what the old behaviour already wrote.

A row is removed when the scan behind it predates the month it is filed under.
The scan's own month keeps its row, so genuine history is preserved and only
the copies disappear. Keywords no longer scanned by any campaign therefore
survive as their original scan, in its real month.

checked_at on rows written before this change records when the row was stored
rather than when the scan ran, so the scan dates are re-read from Local Falcon.

Dry run by default:
    python prune_stale_serp.py
    python prune_stale_serp.py --apply
"""

import argparse
import logging
from collections import defaultdict
from datetime import datetime, timezone

from core.config_loader import load_all_clients
from core.report_generator import parse_scan_date
from core.serp_tracker_localfalcon import _list_all_reports
from portal.api.database import SessionLocal
from portal.api.models import Client, SerpResult

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        doomed, restamped = [], []

        for config in load_all_clients():
            client = db.query(Client).filter(Client.client_id == config.client_id).first()
            lf = config.local_falcon
            if not client or not lf or not lf.api_key or not lf.place_id:
                continue

            # Real scan dates, newest first per keyword.
            scans: dict[str, list[datetime]] = defaultdict(list)
            for r in _list_all_reports(lf.api_key, lf.place_id):
                kw, when = r.get("keyword"), parse_scan_date(r.get("date"))
                if kw and when:
                    scans[kw].append(when)

            rows = db.query(SerpResult).filter(SerpResult.client_id == client.id).all()
            logger.info(f"{config.client_id}: {len(rows)} stored row(s)")

            for row in rows:
                period_start = datetime(row.period_year, row.period_month, 1, tzinfo=timezone.utc)
                candidates = [d for d in scans.get(row.keyword, []) if d < _next_month(period_start)]
                actual = max(candidates) if candidates else None

                if actual is None:
                    logger.info(
                        f"   {row.keyword[:34]:<36} {row.period_year}-{row.period_month:02d}  "
                        f"no scan found in Local Falcon — leaving alone"
                    )
                    continue

                if actual < period_start:
                    doomed.append(row)
                    logger.info(
                        f"   {row.keyword[:34]:<36} {row.period_year}-{row.period_month:02d}  "
                        f"scan is from {actual:%Y-%m-%d} — remove"
                    )
                else:
                    if row.checked_at is None or abs((row.checked_at - actual).days) > 1:
                        restamped.append((row, actual))
                    logger.info(
                        f"   {row.keyword[:34]:<36} {row.period_year}-{row.period_month:02d}  "
                        f"scanned {actual:%Y-%m-%d} — keep"
                    )
            logger.info("")

        if apply:
            for row, actual in restamped:
                row.checked_at = actual
            for row in doomed:
                db.delete(row)
            db.commit()

        logger.info(f"{'Removed' if apply else 'Would remove'}: {len(doomed)} row(s)")
        logger.info(f"{'Restamped' if apply else 'Would restamp'}: {len(restamped)} row(s) with the real scan date")
        if not apply:
            logger.info("\nDry run — re-run with --apply to write these changes.")
    finally:
        db.close()


def _next_month(dt: datetime) -> datetime:
    return datetime(dt.year + 1, 1, 1, tzinfo=timezone.utc) if dt.month == 12 \
        else datetime(dt.year, dt.month + 1, 1, tzinfo=timezone.utc)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    main(parser.parse_args().apply)
