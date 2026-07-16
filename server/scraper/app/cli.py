"""One-shot CLI entrypoint for cron-driven ingest runs.

Unlike the FastAPI endpoints (which kick work into BackgroundTasks on the
long-running web service), this runs a discovery ingest (scrape -> triage ->
embed -> store) to completion in its own process and exits — the mailbot
pattern. Run it as a Render Cron Job using the scraper image:

    python -m app.cli run-all             # every is_active criteria (cron)
    python -m app.cli run <criteria_id>   # one specific criteria
    python -m app.cli eval-recall         # golden-set retrieval recall report
    python -m app.cli seed-demo-jobs      # (re)seed the demo search pool

Because nothing is exposed over HTTP, no X-Cron-Key guard is needed and there's
no free-tier idle-eviction race: the container lives exactly as long as the work.
"""
import argparse
import asyncio
import logging
import random
import sys

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import Settings
from app.indexes import ensure_ttl_index
from app.services import demo_seed, orchestrator, recall_eval

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
        # (same IP) instead of stacking scrapes concurrently. The pause between
        # criteria complements the per-search pacing in scrape_for_criteria.
        for i, c in enumerate(criteria):
            if i > 0:
                pause = random.uniform(30, 60)
                logger.info("run-all: pausing %.0fs before next criteria", pause)
                await asyncio.sleep(pause)
            logger.info("run-all: ingesting '%s' (%s)", c.get("name", "?"), c["id"])
            await orchestrator.run_discovery(db, settings, c["id"])
        logger.info("run-all: done (%d criteria)", len(criteria))
    await _with_db(_r)


async def _seed_demo_jobs():
    async def _r(db, settings):
        await ensure_ttl_index(db)
        result = await demo_seed.seed_demo_jobs(db, settings)
        logger.info("seed-demo-jobs: %s", result)
    await _with_db(_r)


async def _eval_recall(ks: tuple[int, ...], tracker_db: str | None):
    async def _r(db, settings):
        report = await recall_eval.run_eval(db, settings, ks=ks, tracker_db=tracker_db)
        print(report)
    await _with_db(_r)


def main():
    parser = argparse.ArgumentParser(prog="app.cli", description="Discovery ingest cron entrypoint")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Scrape, triage, embed, and store jobs for one criteria")
    run.add_argument("criteria_id", help="SearchCriteria id to run")

    sub.add_parser("run-all", help="Run every criteria with is_active=true, sequentially")

    sub.add_parser(
        "seed-demo-jobs",
        help="(Re)seed the fictional demo search pool: embed the curated postings and insert them")

    ev = sub.add_parser(
        "eval-recall",
        help="Golden-set retrieval recall: where do tracker-saved jobs rank in vector search?")
    ev.add_argument(
        "--k", default=",".join(str(k) for k in recall_eval.DEFAULT_KS),
        help="comma-separated recall@K cutoffs (default: %(default)s)")
    ev.add_argument(
        "--tracker-db", default=None,
        help="tracker DB name when it differs from the scraper DB")

    args = parser.parse_args()

    if args.command == "run":
        asyncio.run(_run(args.criteria_id))
    elif args.command == "run-all":
        asyncio.run(_run_all())
    elif args.command == "seed-demo-jobs":
        asyncio.run(_seed_demo_jobs())
    elif args.command == "eval-recall":
        ks = tuple(int(k) for k in args.k.split(",") if k.strip())
        asyncio.run(_eval_recall(ks or recall_eval.DEFAULT_KS, args.tracker_db))
    else:  # pragma: no cover — argparse enforces a valid command
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
