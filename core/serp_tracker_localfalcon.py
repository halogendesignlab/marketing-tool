"""serp_tracker_localfalcon.py — Fetch geo-grid scan results from Local Falcon API."""

import logging
import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.localfalcon.com"


def _post(client: httpx.Client, path: str, api_key: str, **kwargs) -> dict:
    resp = client.post(f"{BASE_URL}{path}", data={"api_key": api_key, **kwargs})
    resp.raise_for_status()
    return resp.json()


def _parse_report_summary(r: dict) -> dict:
    """Normalise a report-list entry into a consistent summary dict."""
    found_in = int(r.get("found_in") or 0)
    data_points = int(r.get("data_points") or 0)
    raw_arp = r.get("arp")
    arp = float(raw_arp) if raw_arp is not None else None
    # ARP is meaningless when not ranked anywhere
    if found_in == 0:
        arp = None
    solv = float(r.get("solv") or 0)
    return {
        "timestamp": int(r.get("timestamp") or 0),
        "date": r.get("date", ""),
        "arp": arp,
        "solv": solv,
        "found_in": found_in,
        "data_points": data_points,
    }


def _list_all_reports(api_key: str, place_id: str) -> list[dict]:
    """Paginate through all report summaries for a place_id."""
    all_reports: list[dict] = []
    next_token = None
    try:
        with httpx.Client(timeout=30) as client:
            while True:
                kwargs: dict = {"place_id": place_id, "limit": 100}
                if next_token:
                    kwargs["next_token"] = next_token
                data = _post(client, "/v1/reports/", api_key, **kwargs)
                if not data.get("success"):
                    break
                batch = data.get("data", {}).get("reports", [])
                all_reports.extend(batch)
                next_token = data.get("data", {}).get("next_token")
                if not next_token or not batch:
                    break
    except Exception as e:
        logger.warning(f"Local Falcon: pagination failed: {e}")
    return all_reports


def get_keyword_history(api_key: str, place_id: str) -> dict[str, list[dict]]:
    """
    Return all scan summaries grouped by keyword, sorted newest first.

    Each entry:
      {"timestamp": int, "date": str, "arp": float|None,
       "solv": float, "found_in": int, "data_points": int}

    ARP is None when the business wasn't ranked in any grid point.
    """
    if not api_key or not place_id:
        return {}

    raw = _list_all_reports(api_key, place_id)
    by_kw: dict[str, list[dict]] = {}
    for r in raw:
        kw = (r.get("keyword") or "").strip()
        if not kw:
            continue
        by_kw.setdefault(kw, []).append(_parse_report_summary(r))

    for kw in by_kw:
        by_kw[kw].sort(key=lambda x: x["timestamp"], reverse=True)

    return by_kw


def get_latest_scans(api_key: str, place_id: str) -> list[dict]:
    """
    Fetch the most recent scan per keyword for a given Google Place ID.

    Returns a list of dicts, one per keyword:
      {
        "keyword": str,
        "grid_data": [{"lat": float, "lng": float, "rank": int | None}, ...],
        "arp": float | None,
        "solv": float,
        "found_in": int,
        "data_points": int,
        "scan_date": str | None,
        "report_key": str,
      }
    """
    if not api_key or not place_id:
        logger.warning("Local Falcon: api_key or place_id not configured")
        return []

    raw = _list_all_reports(api_key, place_id)
    if not raw:
        logger.info(f"Local Falcon: no reports found for place_id={place_id}")
        return []

    # Most recent scan per keyword (API returns newest first)
    latest_per_keyword: dict[str, dict] = {}
    for r in raw:
        kw = (r.get("keyword") or "").strip()
        if kw and kw not in latest_per_keyword:
            latest_per_keyword[kw] = r

    results = []
    for keyword, summary in latest_per_keyword.items():
        report_key = summary.get("report_key")
        if not report_key:
            continue

        try:
            with httpx.Client(timeout=30) as client:
                full = _post(client, f"/v1/reports/{report_key}/", api_key)
        except Exception as e:
            logger.warning(f"Local Falcon: failed to fetch report {report_key}: {e}")
            continue

        if not full.get("success"):
            logger.warning(f"Local Falcon get report error for {report_key}: {full.get('message')}")
            continue

        rdata = full.get("data", {})
        data_points = rdata.get("data_points", [])

        grid_data = []
        for pt in data_points:
            rank_val = pt.get("rank")
            rank = int(rank_val) if pt.get("found") and rank_val is not False and rank_val is not None else None
            grid_data.append({
                "lat": float(pt["lat"]),
                "lng": float(pt["lng"]),
                "rank": rank,
            })

        parsed = _parse_report_summary(summary)
        logger.info(
            f"Local Falcon [{keyword}]: {len(grid_data)} points, "
            f"{parsed['found_in']} ranked, arp={parsed['arp']}, solv={parsed['solv']}"
        )

        results.append({
            "keyword": keyword,
            "grid_data": grid_data,
            "arp": parsed["arp"],
            "solv": parsed["solv"],
            "found_in": parsed["found_in"],
            "data_points": parsed["data_points"],
            "scan_date": summary.get("date"),
            "report_key": report_key,
        })

    return results


def compute_rank_trends(
    current_grid: list[dict],
    previous_grid: list[dict] | None,
) -> list[dict]:
    """
    Merge current and previous geo-grid data to produce trend information.
    Returns list of {lat, lng, rank, prev_rank, change} where change = prev_rank - rank
    (positive = improved, negative = dropped, 0 = same, None if either rank is missing).
    """
    if not previous_grid:
        return [
            {**pt, "prev_rank": None, "change": None}
            for pt in current_grid
        ]

    # Build a lookup from (lat, lng) -> rank for previous grid
    prev_lookup: dict[tuple[float, float], int | None] = {
        (p["lat"], p["lng"]): p.get("rank")
        for p in previous_grid
    }

    result = []
    for pt in current_grid:
        key = (pt["lat"], pt["lng"])
        prev_rank = prev_lookup.get(key)
        current_rank = pt.get("rank")
        if current_rank is not None and prev_rank is not None:
            change = prev_rank - current_rank
        else:
            change = None
        result.append({**pt, "prev_rank": prev_rank, "change": change})

    return result
