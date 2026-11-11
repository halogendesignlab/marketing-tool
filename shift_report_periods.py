"""shift_report_periods.py — File each stored report under the month it went out in.

Reports are named for the month they are delivered rather than the month they
cover: the run on 1 November measures October and is now filed as November.
generate_report_job already does this for new reports; this moves the ones that
were filed under their measured month.

Each report's period moves forward one month. Its contents are untouched — the
data inside still measures the month it always did.

A report already sitting on a target period is overwritten, but only if it is
empty. An empty one is the residue of a manual mid-month run; anything with real
data in the way means something unexpected, so the script stops instead.

Dry run by default:
    python shift_report_periods.py
    python shift_report_periods.py --apply
"""

import argparse
import logging

from portal.api.database import SessionLocal
from portal.api.models import Client, Report

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def _next_period(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _is_empty(report: Report) -> bool:
    """True when nothing was actually measured — a mid-month manual run.

    A SERP section is not evidence on its own. A mid-month run still writes the
    keyword grid, just with every rank null, so the ranks are what count rather
    than the presence of the section.
    """
    data = report.data or {}
    gsc = data.get("gsc") or {}
    content = data.get("content") or {}
    ranked = any(
        point.get("rank") is not None
        for entry in (data.get("serp") or [])
        for point in (entry.get("grid_data") or [])
    )
    return (
        not gsc.get("top_queries")
        and not gsc.get("total_clicks")
        and not content.get("total_published")
        and not ranked
    )


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        names = {c.id: c.client_id for c in db.query(Client).all()}
        reports = db.query(Report).all()
        by_period = {(r.client_id, r.period_year, r.period_month): r for r in reports}

        # Newest first, so a report never lands on one that has yet to move.
        movers = sorted(
            (r for r in reports if not _is_empty(r)),
            key=lambda r: (r.client_id, -(r.period_year * 12 + r.period_month)),
        )
        displaced = [r for r in reports if _is_empty(r)]

        for r in displaced:
            logger.info(
                f"{names.get(r.client_id):<22} {r.period_year}-{r.period_month:02d} "
                f"is empty -> will be removed (id={r.id})"
            )
        if displaced:
            logger.info("")

        plan = []
        for r in movers:
            ny, nm = _next_period(r.period_year, r.period_month)
            blocker = by_period.get((r.client_id, ny, nm))
            if blocker is not None and blocker not in movers and blocker not in displaced:
                raise SystemExit(
                    f"{names.get(r.client_id)} {ny}-{nm:02d} already holds data "
                    f"(id={blocker.id}); refusing to overwrite it"
                )
            plan.append((r, ny, nm))
            logger.info(
                f"{names.get(r.client_id):<22} {r.period_year}-{r.period_month:02d} "
                f"-> {ny}-{nm:02d}"
            )

        if apply:
            for r in displaced:
                db.delete(r)
            db.flush()
            for r, ny, nm in plan:
                r.period_year, r.period_month = ny, nm
            db.commit()

        logger.info("")
        logger.info(f"{'Moved' if apply else 'Would move'}: {len(plan)} report(s)")
        logger.info(f"{'Removed' if apply else 'Would remove'}: {len(displaced)} empty report(s)")
        if not apply:
            logger.info("\nDry run — re-run with --apply to write these changes.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    main(parser.parse_args().apply)
