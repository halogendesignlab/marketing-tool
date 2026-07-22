"""gsc_tracker.py — Pull Google Search Console search analytics."""

import logging
from datetime import date, timedelta
from .config_loader import ClientConfig
from portal.api.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def _gsc_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(
        settings.GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=SCOPES,
    )
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start, end


def _query_analytics(service, site_url: str, start: date, end: date, dimensions: list[str], row_limit: int = 25) -> list[dict]:
    try:
        resp = service.searchanalytics().query(
            siteUrl=site_url,
            body={
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "dimensions": dimensions,
                "rowLimit": row_limit,
                "dataState": "all",
            }
        ).execute()
        return resp.get("rows", [])
    except Exception as e:
        logger.warning(f"GSC query failed ({dimensions}): {e}")
        return []


def get_search_analytics(config: ClientConfig, month: int, year: int) -> dict:
    """
    Pull Search Console analytics for the given month.
    Returns dict with top_queries, top_pages, totals, prev_totals.
    Returns {} if GSC not configured.
    """
    if not config.gsc:
        return {}
    if not settings.GOOGLE_SERVICE_ACCOUNT_FILE:
        logger.warning(f"[{config.client_id}] No Google service account file configured")
        return {}

    try:
        service = _gsc_service()
    except Exception as e:
        logger.error(f"[{config.client_id}] Failed to build GSC service: {e}")
        return {}

    site_url = config.gsc.site_url

    # Date ranges
    cur_start, cur_end = _month_range(year, month)
    prev_month = month - 1 if month > 1 else 12
    prev_year = year if month > 1 else year - 1
    prev_start, prev_end = _month_range(prev_year, prev_month)

    logger.info(f"[{config.client_id}] Pulling GSC data for {site_url} ({cur_start} to {cur_end})")

    # Top queries this month
    cur_query_rows = _query_analytics(service, site_url, cur_start, cur_end, ["query"], row_limit=20)
    prev_query_rows = _query_analytics(service, site_url, prev_start, prev_end, ["query"], row_limit=50)

    # Build prev lookup by query
    prev_by_query = {row["keys"][0]: row for row in prev_query_rows}

    top_queries = []
    for row in cur_query_rows:
        q = row["keys"][0]
        prev = prev_by_query.get(q)
        top_queries.append({
            "query": q,
            "clicks": int(row.get("clicks", 0)),
            "impressions": int(row.get("impressions", 0)),
            "ctr": round(row.get("ctr", 0) * 100, 1),
            "position": round(row.get("position", 0), 1),
            "prev_position": round(prev["position"], 1) if prev else None,
            "prev_clicks": int(prev["clicks"]) if prev else None,
        })

    # Top pages this month
    cur_page_rows = _query_analytics(service, site_url, cur_start, cur_end, ["page"], row_limit=10)
    top_pages = []
    for row in cur_page_rows:
        top_pages.append({
            "page": row["keys"][0],
            "clicks": int(row.get("clicks", 0)),
            "impressions": int(row.get("impressions", 0)),
            "position": round(row.get("position", 0), 1),
        })

    # Site totals (no dimension = aggregate)
    # GSC doesn't support 0-dimension queries directly; sum from query rows
    total_clicks = sum(r.get("clicks", 0) for r in cur_query_rows)
    total_impressions = sum(r.get("impressions", 0) for r in cur_query_rows)
    prev_total_clicks = sum(r.get("clicks", 0) for r in prev_query_rows)
    prev_total_impressions = sum(r.get("impressions", 0) for r in prev_query_rows)

    return {
        "site_url": site_url,
        "top_queries": top_queries,
        "top_pages": top_pages,
        "total_clicks": int(total_clicks),
        "total_impressions": int(total_impressions),
        "prev_total_clicks": int(prev_total_clicks),
        "prev_total_impressions": int(prev_total_impressions),
    }
