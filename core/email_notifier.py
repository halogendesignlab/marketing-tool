"""email_notifier.py — Transactional email via Resend."""

import resend
from portal.api.settings import get_settings

settings = get_settings()
resend.api_key = settings.RESEND_API_KEY

FROM = settings.RESEND_FROM_EMAIL


def send_content_ready(
    to: str,
    brand_name: str,
    count: int,
    portal_url: str = "https://portal.halogendesignlabs.com",
) -> None:
    """Notify client that new content is ready for approval."""
    resend.Emails.send({
        "from": FROM,
        "to": to,
        "subject": f"{brand_name}: {count} post{'s' if count != 1 else ''} ready for review",
        "html": f"""
        <p>Hi,</p>
        <p>{count} new post{'s are' if count != 1 else ' is'} ready for your review in the {brand_name} portal.</p>
        <p><a href="{portal_url}/approvals">Review and approve →</a></p>
        <p>— Halogen Design Labs</p>
        """,
    })


def send_report_ready(
    to: str,
    brand_name: str,
    month: str,
    portal_url: str = "https://portal.halogendesignlabs.com",
) -> None:
    """Notify client that their monthly report is ready."""
    resend.Emails.send({
        "from": FROM,
        "to": to,
        "subject": f"{brand_name}: Your {month} performance report is ready",
        "html": f"""
        <p>Hi,</p>
        <p>Your {month} performance report for {brand_name} is ready to view.</p>
        <p><a href="{portal_url}/reports">View your report →</a></p>
        <p>— Halogen Design Labs</p>
        """,
    })


def send_review_alert(
    to: str,
    brand_name: str,
    platform: str,
    rating: int | None,
    portal_url: str = "https://portal.halogendesignlabs.com",
) -> None:
    """Notify that a new review has been detected and a response is drafted."""
    stars = f"{rating}/5 stars — " if rating else ""
    resend.Emails.send({
        "from": FROM,
        "to": to,
        "subject": f"{brand_name}: New {platform.capitalize()} review — response ready",
        "html": f"""
        <p>Hi,</p>
        <p>A new {stars}{platform.capitalize()} review has been detected for {brand_name}.</p>
        <p>A response has been drafted and is waiting for your approval.</p>
        <p><a href="{portal_url}/reviews">Review and approve response →</a></p>
        <p>— Halogen Design Labs</p>
        """,
    })


def send_directory_alert(
    to: str,
    brand_name: str,
    issue_count: int,
    portal_url: str = "https://portal.halogendesignlabs.com",
) -> None:
    """Notify that directory/NAP issues were found."""
    resend.Emails.send({
        "from": FROM,
        "to": to,
        "subject": f"{brand_name}: {issue_count} directory issue{'s' if issue_count != 1 else ''} found",
        "html": f"""
        <p>Hi,</p>
        <p>{issue_count} NAP inconsistenc{'ies were' if issue_count != 1 else 'y was'} found across online directories for {brand_name}.</p>
        <p><a href="{portal_url}/directories">View directory issues →</a></p>
        <p>— Halogen Design Labs</p>
        """,
    })


def send_publish_failure(
    to: str,
    brand_name: str,
    content_type: str,
    platform: str,
    error: str,
    portal_url: str = "https://portal.halogendesignlabs.com",
) -> None:
    """Notify admin that a publish attempt failed."""
    resend.Emails.send({
        "from": FROM,
        "to": to,
        "subject": f"[ACTION REQUIRED] {brand_name}: Failed to publish {content_type} to {platform}",
        "html": f"""
        <p>A publish attempt failed for {brand_name}.</p>
        <ul>
            <li><strong>Content type:</strong> {content_type}</li>
            <li><strong>Platform:</strong> {platform}</li>
            <li><strong>Error:</strong> {error}</li>
        </ul>
        <p><a href="{portal_url}/approvals">View content queue →</a></p>
        <p>— Halogen Automation</p>
        """,
    })
