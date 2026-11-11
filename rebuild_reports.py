"""rebuild_reports.py — Regenerate stored reports against current data sources.

Reports are snapshots: whatever the data looked like when the report ran is
what it keeps. After fixing how a figure is measured, the stored reports still
carry the old one until they are rebuilt.

Each report is filed under the month it went out in and measures the month
before, so a report labelled November measures October.

Dry run by default:
    python rebuild_reports.py
    python rebuild_reports.py --apply
    python rebuild_reports.py --apply --client moorhouse_homes
"""

import argparse
import logging

from core.config_loader import load_all_clients
from core.report_generator import generate_monthly_report
from portal.api.database import SessionLocal
from portal.api.models import Client, Report

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def _measured(label_year: int, label_month: int) -> tuple[int, int]:
    """The month a report labelled label_month actually measures."""
    return (label_year - 1, 12) if label_month == 1 else (label_year, label_month - 1)


def main(apply: bool, only_client: str | None) -> None:
    db = SessionLocal()
    try:
        names = {c.id: c.client_id for c in db.query(Client).all()}
        configs = {c.client_id: c for c in load_all_clients()}

        reports = db.query(Report).order_by(Report.client_id, Report.period_month).all()
        targets = [
            r for r in reports
            if names.get(r.client_id) in configs
            and (not only_client or names.get(r.client_id) == only_client)
        ]

        skipped = [r for r in reports if names.get(r.client_id) not in configs]
        for r in skipped:
            logger.info(f"no config for client {r.client_id} — skipping its {r.period_year}-{r.period_month:02d}")

        logger.info(f"{len(targets)} report(s) to rebuild\n")

        for r in targets:
            client_id = names[r.client_id]
            m_year, m_month = _measured(r.period_year, r.period_month)
            old = (r.data or {}).get("gsc") or {}
            before = f"clicks={old.get('total_clicks', 0)} impr={old.get('total_impressions', 0)}"

            if not apply:
                logger.info(
                    f"{client_id:<22} {r.period_year}-{r.period_month:02d} "
                    f"(measures {m_year}-{m_month:02d})   currently {before}"
                )
                continue

            data = generate_monthly_report(
                configs[client_id], m_month, m_year,
                label_month=r.period_month, label_year=r.period_year,
            )
            new = (data or {}).get("gsc") or {}
            logger.info(
                f"{client_id:<22} {r.period_year}-{r.period_month:02d}   "
                f"{before}  ->  clicks={new.get('total_clicks', 0)} "
                f"impr={new.get('total_impressions', 0)}"
            )

        if not apply:
            logger.info("\nDry run — re-run with --apply to rebuild these.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="rebuild (default: dry run)")
    parser.add_argument("--client", help="limit to one client_id")
    main(parser.parse_args().apply, parser.parse_args().client)
