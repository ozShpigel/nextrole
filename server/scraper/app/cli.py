"""One-shot CLI entrypoint for cron-driven ingest runs.

Unlike the FastAPI endpoints (which kick work into BackgroundTasks on the
long-running web service), this runs a discovery ingest (scrape -> triage ->
embed -> store) to completion in its own process and exits — the mailbot
pattern. Run it as a Render Cron Job using the scraper image:

    python -m app.cli run-all             # every is_active criteria (cron)
    python -m app.cli run <criteria_id>   # one specific criteria

Because nothing is exposed over HTTP, no X-Cron-Key guard is needed and there's
no free-tier idle-eviction race: the container lives exactly as long as the work.
"""
import argparse
import asyncio
import logging
import sys

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import Settings
from app.indexes import ensure_ttl_index
from app.services import orchestrator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cli")


async def _with_db(coro_factory):
    settings = Settings()
    client = AsyncIOMotorClient(settings.mongodb_connection_string, tlsCAFile=certifi.where())
    try:
        db = client[settings.mongodb_database_name]
        await coro_factory(db, settings)
    finally:
        client.close()


async def _run(criteria_id: str):
    async def _r(db, settings):
        await ensure_ttl_index(db)
        logger.info("Ingest run for criteria %s", criteria_id)
        await orchestrator.run_discovery(db, settings, criteria_id)
        logger.info("Ingest run done")
    await _with_db(_r)


async def _run_all():
    async def _r(db, settings):
        await ensure_ttl_index(db)
        criteria = await db.search_criteria.find({"is_active": True}).to_list(100)
        if not criteria:
            # Exit non-zero so a cron run visibly fails instead of silently
            # doing nothing (e.g. the last criteria was deleted/disabled).
            logger.error("run-all: no active criteria found — nothing to ingest")
            sys.exit(1)
        logger.info("run-all: %d active criteria", len(criteria))
        # Sequential on purpose: keeps LinkedIn request bursts serialized
        # (same IP) instead of stacking scrapes concurrently.
        for c in criteria:
            logger.info("run-all: ingesting '%s' (%s)", c.get("name", "?"), c["id"])
            await orchestrator.run_discovery(db, settings, c["id"])
        logger.info("run-all: done (%d criteria)", len(criteria))
    await _with_db(_r)


def main():
    parser = argparse.ArgumentParser(prog="app.cli", description="Discovery ingest cron entrypoint")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Scrape, triage, embed, and store jobs for one criteria")
    run.add_argument("criteria_id", help="SearchCriteria id to run")

    sub.add_parser("run-all", help="Run every criteria with is_active=true, sequentially")

    args = parser.parse_args()

    if args.command == "run":
        asyncio.run(_run(args.criteria_id))
    elif args.command == "run-all":
        asyncio.run(_run_all())
    else:  # pragma: no cover — argparse enforces a valid command
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
