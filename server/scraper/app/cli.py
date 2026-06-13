"""One-shot CLI entrypoint for cron-driven batch discovery.

Unlike the FastAPI endpoints (which kick work into BackgroundTasks on the
long-running web service), this runs the batch cycle to completion in its own
process and exits — the mailbot pattern. Run it as a Render Cron Job using the
scraper image:

    python -m app.cli run-batch-cycle <criteria_id>   # collect-then-submit
    python -m app.cli finalize                         # collect-only

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


async def _run_batch_cycle(criteria_id: str):
    async def _cycle(db, settings):
        logger.info("Batch cycle: finalizing any ready batches first")
        await orchestrator.finalize_batches(db, settings)
        logger.info("Batch cycle: submitting fresh batch for criteria %s", criteria_id)
        await orchestrator.run_discovery_batch(db, settings, criteria_id)
        logger.info("Batch cycle done")
    await _with_db(_cycle)


async def _finalize():
    async def _f(db, settings):
        logger.info("Finalize-only: collecting ready batches")
        await orchestrator.finalize_batches(db, settings)
        logger.info("Finalize done")
    await _with_db(_f)


def main():
    parser = argparse.ArgumentParser(prog="app.cli", description="Batch discovery cron entrypoint")
    sub = parser.add_subparsers(dest="command", required=True)

    cycle = sub.add_parser("run-batch-cycle", help="Collect prior batch, then submit a new one")
    cycle.add_argument("criteria_id", help="SearchCriteria id to run")

    sub.add_parser("finalize", help="Collect-only: finalize any ready batches")

    args = parser.parse_args()

    if args.command == "run-batch-cycle":
        asyncio.run(_run_batch_cycle(args.criteria_id))
    elif args.command == "finalize":
        asyncio.run(_finalize())
    else:  # pragma: no cover — argparse enforces a valid command
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
