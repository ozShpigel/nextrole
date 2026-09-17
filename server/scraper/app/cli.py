"""One-shot CLI entrypoint for cron-driven ingest runs.

Unlike the FastAPI endpoints (which serve requests on the long-running web
service), this runs the ingest (scrape -> dedupe -> extract facts -> store) to
completion in its own process and exits — the mailbot pattern. Run it as a cron
job using the scraper image:

    python -m app.cli run-pool            # daily shared-pool ingest (cron)

The only command left. The criteria-driven runs and the demo seeders went with
the criteria path (Phase 0); the golden-set evals became a .NET console project
in Phase 3c, because they measure the API and never belonged to a scraper. This
one goes too, once PoolIngest has proved itself — see docs/scraper-slimming.md.

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
from app import roles
from app.services import pool

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


async def _run_pool():
    """Daily shared-pool ingest: one run over the configured role list, folded
    into the pool everyone reads. Not driven by anyone's profile or saved
    search — see docs/job-pool.md."""
    async def _r(db, settings):
        # Keep the classifier view of "already searched" current before the
        # run reads the grown half back out of the same collection.
        await roles.publish_baseline(db, roles.load(settings.roles_config_path or None))
        run = await pool.run_pool_ingest(db, settings)
        if run.status == "failed":
            # Exit non-zero so a cron failure is visible instead of a green tick
            # over a run that ingested nothing.
            logger.error("run-pool: %s", run.error)
            sys.exit(1)
    await _with_db(_r)


def main():
    parser = argparse.ArgumentParser(prog="app.cli", description="Discovery ingest cron entrypoint")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser(
        "run-pool",
        help="Daily shared-pool ingest over the configured role list (config/roles.json)")

    args = parser.parse_args()

    if args.command == "run-pool":
        asyncio.run(_run_pool())
    else:  # pragma: no cover — argparse enforces a valid command
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
