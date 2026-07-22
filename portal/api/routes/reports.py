"""routes/reports.py - Performance report endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Report, User, UserRole
from ..auth import get_current_user, require_admin
from ..schemas import ReportResponse

router = APIRouter()


@router.get("/", response_model=list[ReportResponse])
def list_reports(
    client_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Report)

    if current_user.role != "admin":
        query = query.filter(Report.client_id == current_user.client_id)
    elif client_id:
        query = query.filter(Report.client_id == client_id)

    return query.order_by(Report.period_year.desc(), Report.period_month.desc()).all()


@router.get("/{report_id}", response_model=ReportResponse)
def get_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if current_user.role != "admin" and report.client_id != current_user.client_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return report


@router.get("/latest/{client_id}", response_model=ReportResponse)
def get_latest_report(
    client_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "admin" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="Access denied")

    report = (
        db.query(Report)
        .filter(Report.client_id == client_id)
        .order_by(Report.period_year.desc(), Report.period_month.desc())
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="No reports found")

    return report


@router.post("/generate")
def trigger_report(
    background_tasks: BackgroundTasks,
    month: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin-only: manually trigger report generation for the current (or given) month.
    If client_id is provided, only generates for that client; otherwise generates for all."""
    from datetime import datetime, timezone
    from ..models import Client
    now = datetime.now(timezone.utc)
    m = month or now.month
    y = year or now.year

    if client_id:
        client = db.query(Client).filter(Client.id == client_id).first()
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        background_tasks.add_task(_run_report_bg, m, y, client.client_id)
        return {"ok": True, "month": m, "year": y, "client": client.client_id}

    background_tasks.add_task(_run_report_bg, m, y, None)
    return {"ok": True, "month": m, "year": y}


def _run_report_bg(month: int, year: int, client_id_filter: Optional[str] = None):
    from core.config_loader import load_all_clients
    from core.report_generator import generate_monthly_report
    import logging
    logger = logging.getLogger(__name__)
    for config in load_all_clients():
        if client_id_filter and config.client_id != client_id_filter:
            continue
        try:
            generate_monthly_report(config, month, year)
        except Exception as e:
            logger.error(f"Report failed for {config.client_id}: {e}")
