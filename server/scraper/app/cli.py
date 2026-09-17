"""One-shot CLI entrypoint for cron-driven ingest runs.

Unlike the FastAPI endpoints (which serve requests on the long-running web
service), this runs the ingest (scrape -> dedupe -> extract facts -> store) to
completion in its own process and exits — the mailbot pattern. Run it as a cron
job using the scraper image:

    python -m app.cli run-pool            # daily shared-pool ingest (cron)
    python -m app.cli eval-verdict        # golden-set Evaluator verdict report
    python -m app.cli eval-subscore       # golden-set Evaluator sub-score report (frozen profile)

The criteria-driven commands (`run`, `run-all`) and the demo seeders went with
the criteria path — see docs/scraper-slimming.md.

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
from app.services import pool, subscore_eval, verdict_eval

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


async def _eval_verdict(runs: int):
    # No Mongo needed — this calls the API directly against the golden set.
    settings = Settings()
    cases = verdict_eval.load_golden_set()
    if runs <= 1:
        results = await verdict_eval.run_eval(settings, cases)
        print(verdict_eval.format_report(results))
    else:
        all_results = []
        for i in range(runs):
            logger.info("eval-verdict: run %d/%d", i + 1, runs)
            all_results.append(await verdict_eval.run_eval(settings, cases))
        print(verdict_eval.format_multi_run_report(all_results))


async def _eval_subscore():
    # No Mongo needed — scores against the frozen tests/fixtures/golden-profile.json via the API.
    settings = Settings()
    results = await subscore_eval.run_eval(settings)
    print(subscore_eval.format_report(results))


def main():
    parser = argparse.ArgumentParser(prog="app.cli", description="Discovery ingest cron entrypoint")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser(
        "run-pool",
        help="Daily shared-pool ingest over the configured role list (config/roles.json)")

    everdict = sub.add_parser(
        "eval-verdict",
        help="Golden-set Evaluator verdict report: does /api/match score known postings correctly?")
    everdict.add_argument(
        "--runs", type=int, default=1,
        help="repeat N times and report a noise baseline (pass-rate spread + flaky cases)")

    sub.add_parser(
        "eval-subscore",
        help="Golden-set Evaluator sub-score report: per-dimension band checks against a frozen profile")

    args = parser.parse_args()

    if args.command == "run-pool":
        asyncio.run(_run_pool())
    elif args.command == "eval-verdict":
        asyncio.run(_eval_verdict(args.runs))
    elif args.command == "eval-subscore":
        asyncio.run(_eval_subscore())
    else:  # pragma: no cover — argparse enforces a valid command
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
