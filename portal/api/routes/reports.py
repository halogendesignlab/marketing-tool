"""routes/reports.py - Performance report endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Report, User
from ..auth import get_current_user
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
