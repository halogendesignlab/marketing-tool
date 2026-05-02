"""report_generator.py — Compile monthly performance reports from all data sources."""

import logging
from datetime import datetime, timedelta
from .config_loader import ClientConfig
from .gbp_manager import get_gbp_insights
from .serp_tracker import run_geo_grid_scan
from portal.api.database import SessionLocal
from portal.api.models import Report, ContentItem, Review, DirectoryListing

logger = logging.getLogger(__name__)


def generate_monthly_report(config: ClientConfig, month: int, year: int) -> dict:
    """Compile a monthly report from all data sources."""
    db = SessionLocal()
    
    try:
        # Get client ID
        from portal.api.models import Client
        client = db.query(Client).filter(Client.client_id == config.client_id).first()
        if not client:
            raise ValueError(f"Client {config.client_id} not found in database")

        # Collect data
        report_data = {
            "client_id": client.id,
            "month": month,
            "year": year,
            "generated_at": datetime.utcnow(),
            "sections": {}
        }

        # GBP Insights
        gbp_insights = get_gbp_insights(config)
        report_data["sections"]["gbp"] = gbp_insights

        # Content Published
        start_date = datetime(year, month, 1)
        if month == 12:
            end_date = datetime(year + 1, 1, 1)
        else:
            end_date = datetime(year, month + 1, 1)

        published_content = db.query(ContentItem).filter(
            ContentItem.client_id == client.id,
            ContentItem.published_at >= start_date,
            ContentItem.published_at < end_date,
        ).all()

        report_data["sections"]["content"] = {
            "total_published": len(published_content),
            "by_type": {
                "social": len([c for c in published_content if c.content_type == "social_caption"]),
                "blog": len([c for c in published_content if c.content_type == "blog_post"]),
                "gbp": len([c for c in published_content if c.content_type == "gbp_post"]),
            }
        }

        # Reviews
        reviews = db.query(Review).filter(
            Review.client_id == client.id,
            Review.detected_at >= start_date,
            Review.detected_at < end_date,
        ).all()

        report_data["sections"]["reviews"] = {
            "total_new": len(reviews),
            "responded": len([r for r in reviews if r.responded_at]),
            "by_platform": {
                "google": len([r for r in reviews if r.platform == "google"]),
                "facebook": len([r for r in reviews if r.platform == "facebook"]),
                "yelp": len([r for r in reviews if r.platform == "yelp"]),
            }
        }

        # Directory Issues
        directory_issues = db.query(DirectoryListing).filter(
            DirectoryListing.client_id == client.id,
            DirectoryListing.is_consistent == False,
        ).all()

        report_data["sections"]["directories"] = {
            "total_issues": len(directory_issues),
            "by_directory": {}
        }
        for issue in directory_issues:
            report_data["sections"]["directories"]["by_directory"].setdefault(issue.directory, 0)
            report_data["sections"]["directories"]["by_directory"][issue.directory] += 1

        # Save report to database
        report = Report(
            client_id=client.id,
            month=month,
            year=year,
            data=report_data,
            generated_at=datetime.utcnow(),
        )
        db.add(report)
        db.commit()

        logger.info(f"Generated report for {config.brand_name} ({month}/{year})")
        return report_data

    except Exception as e:
        logger.error(f"Failed to generate report for {config.client_id}: {e}")
        db.rollback()
        raise
    finally:
        db.close()
