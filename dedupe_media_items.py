"""dedupe_media_items.py — Remove duplicate media rows pointing at the same image.

The Drive sync used to import a photo once per folder it was filed in, and the
R2 key is only client/filename, so both copies landed on one object with two
rows pointing at it. core.drive_watcher._classify_drive_files stops new ones
being created; this clears out the rows already there.

Rows are grouped by (client_id, url). The row carrying the most metadata wins,
ties going to the lowest id so the original survives. Since every row in a group
shares a url, content items referencing that url stay valid.

Dry run by default:
    python dedupe_media_items.py
    python dedupe_media_items.py --apply
"""

import argparse
import collections
import logging

from portal.api.database import SessionLocal
from portal.api.models import ContentItem, MediaItem

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def _richness(item: MediaItem) -> tuple[int, int]:
    """Sort key: most populated metadata first, then oldest row."""
    meta = item.meta or {}
    populated = sum(1 for v in meta.values() if v)
    return (-populated, item.id)


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        rows = db.query(MediaItem).all()
        groups: dict[tuple[int, str], list[MediaItem]] = collections.defaultdict(list)
        for row in rows:
            groups[(row.client_id, row.url)].append(row)

        dupes = {k: v for k, v in groups.items() if len(v) > 1}
        in_use = {
            u for (u,) in db.query(ContentItem.image_url)
            .filter(ContentItem.image_url.isnot(None)).all()
        }

        logger.info(f"{len(rows)} rows, {len(groups)} distinct images")
        logger.info(f"{len(dupes)} images have more than one row\n")

        SHOW = 5
        doomed: list[MediaItem] = []
        for shown, ((_, url), items) in enumerate(sorted(dupes.items(), key=lambda kv: kv[0][1])):
            keep, *rest = sorted(items, key=_richness)
            doomed.extend(rest)
            if shown < SHOW:
                flag = "  [referenced by a content item]" if url in in_use else ""
                logger.info(f"{keep.filename}{flag}")
                logger.info(f"    keep   id={keep.id} meta={keep.meta}")
                for r in rest:
                    logger.info(f"    drop   id={r.id} meta={r.meta}")

        if len(dupes) > SHOW:
            logger.info(f"… and {len(dupes) - SHOW} more groups\n")

        # Every group shares one url and the survivor keeps it, so no content
        # item can be left pointing at an image with no row behind it.
        orphaned = {r.url for r in doomed if r.url in in_use} - {
            k[1] for k in groups if k[1] in in_use
        }
        assert not orphaned, f"would orphan content items: {orphaned}"

        if apply and doomed:
            for row in doomed:
                db.delete(row)
            db.commit()

        remaining = db.query(MediaItem).count()
        logger.info(f"{'Deleted' if apply else 'Would delete'}: {len(doomed)} rows")
        logger.info(f"Library {'now' if apply else 'would be'}: {remaining if apply else len(rows) - len(doomed)} rows")
        if not apply and doomed:
            logger.info("\nDry run — re-run with --apply to delete these rows.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="delete rows (default: dry run)")
    main(parser.parse_args().apply)
