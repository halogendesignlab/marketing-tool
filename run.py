"""run.py — CLI runner for manual tasks and onboarding."""

import argparse
import sys
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

TASKS = [
    "generate_captions",
    "generate_blog",
    "generate_gbp_post",
    "check_drive",
    "publish_approved",
    "onboard",
]


def main():
    parser = argparse.ArgumentParser(description="Halogen Marketing Automation CLI")
    parser.add_argument("--client", required=True, help="Client ID (e.g. moorhouse_commercial)")
    parser.add_argument("--task", required=True, choices=TASKS, help="Task to run")
    args = parser.parse_args()

    client_id = args.client
    task = args.task

    # Validate client exists
    from core.config_loader import load_client_config
    try:
        config = load_client_config(client_id)
    except FileNotFoundError as e:
        logger.error(str(e))
        sys.exit(1)

    logger.info(f"Running task '{task}' for client '{client_id}' ({config.brand_name})")

    if task == "generate_captions":
        from scheduler.scheduler import generate_social_captions_job
        generate_social_captions_job(client_id)

    elif task == "generate_blog":
        from scheduler.scheduler import generate_blog_draft_job
        generate_blog_draft_job(client_id)

    elif task == "generate_gbp_post":
        from scheduler.scheduler import generate_gbp_post_job
        generate_gbp_post_job(client_id)

    elif task == "check_drive":
        from scheduler.scheduler import check_drive_assets_job
        check_drive_assets_job(client_id)

    elif task == "publish_approved":
        from scheduler.scheduler import publish_approved_content_job
        publish_approved_content_job(client_id)

    elif task == "onboard":
        _onboard(config)

    logger.info(f"Task '{task}' complete.")


def _onboard(config):
    """Validate config, create DB records, provision portal user, send welcome email."""
    from portal.api.database import SessionLocal, engine
    from portal.api.models import Base, Client, User, UserRole
    from portal.api.auth import hash_password
    from core.email_notifier import send_content_ready
    import secrets

    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Check if client already exists
        existing = db.query(Client).filter(Client.client_id == config.client_id).first()
        if existing:
            logger.info(f"Client '{config.client_id}' already exists in database — skipping creation")
            client_db = existing
        else:
            client_db = Client(
                client_id=config.client_id,
                brand_name=config.brand_name,
                industry=config.industry,
                tone=config.tone,
                location_city=config.location.city,
                location_state=config.location.state,
                location_lat=config.location.lat,
                location_lng=config.location.lng,
            )
            db.add(client_db)
            db.flush()
            logger.info(f"Created client record: {config.brand_name}")

        # Create portal users
        for portal_user in config.portal_users:
            existing_user = db.query(User).filter(User.email == portal_user.email).first()
            if existing_user:
                logger.info(f"User {portal_user.email} already exists — skipping")
                continue

            temp_password = secrets.token_urlsafe(12)
            user = User(
                email=portal_user.email,
                name=portal_user.name,
                hashed_password=hash_password(temp_password),
                role=UserRole(portal_user.role),
                client_id=client_db.id,
            )
            db.add(user)
            logger.info(f"Created portal user: {portal_user.email} (temp password: {temp_password})")

        db.commit()
        logger.info(f"Onboarding complete for {config.brand_name}")

    except Exception as e:
        db.rollback()
        logger.error(f"Onboarding failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
