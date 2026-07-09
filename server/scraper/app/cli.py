"""One-shot CLI entrypoint for cron-driven ingest runs.

Unlike the FastAPI endpoints (which kick work into BackgroundTasks on the
long-running web service), this runs a discovery ingest (scrape -> triage ->
embed -> store) to completion in its own process and exits — the mailbot
pattern. Run it as a Render Cron Job using the scraper image:

    python -m app.cli run <criteria_id>

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
        logger.info("Ingest run for criteria %s", criteria_id)
        await orchestrator.run_discovery(db, settings, criteria_id)
        logger.info("Ingest run done")
    await _with_db(_r)


def main():
    parser = argparse.ArgumentParser(prog="app.cli", description="Discovery ingest cron entrypoint")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Scrape, triage, embed, and store jobs for a criteria")
    run.add_argument("criteria_id", help="SearchCriteria id to run")

    args = parser.parse_args()

    if args.command == "run":
        asyncio.run(_run(args.criteria_id))
    else:  # pragma: no cover — argparse enforces a valid command
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
