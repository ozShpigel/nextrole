"""What the running container needs, not just what the source tree has.

The scraper read its role list from a file for the first time in the shared-pool
work, and `roles.load()` is deliberately fatal without it - a run over a default
role list nobody wrote would be worse than no run. Every test and every local
run had the file, because they run from the source tree. The image did not: the
Dockerfile copied `app/` and nothing else, so both deployed scrapers started,
completed their migrations, and exited on the first lifespan hook with
FileNotFoundError.

A path the code reads at startup has to be in the image. These tests are that
check.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # server/scraper
DOCKERFILE = ROOT / "Dockerfile"


def _copied_sources() -> list[str]:
    """The source side of every COPY in the Dockerfile, repo-root-relative."""
    text = DOCKERFILE.read_text(encoding="utf-8")
    return [
        m.group(1)
        for m in re.finditer(r"^\s*COPY\s+(\S+)\s+\S+\s*$", text, re.MULTILINE)
    ]


def test_the_roles_config_exists_where_the_code_looks_for_it():
    # app.config.Settings.roles_config_path defaults to this, resolved from the
    # working directory - /app in the image, server/scraper when run locally.
    assert (ROOT / "config" / "roles.json").is_file()


def test_the_image_carries_the_roles_config():
    sources = _copied_sources()
    assert any(s.rstrip("/").endswith("server/scraper/config") for s in sources), (
        "the Dockerfile does not COPY server/scraper/config — app.roles.load() is "
        f"fatal without it and the container will exit at startup. COPYs found: {sources}"
    )


def test_every_startup_path_outside_app_is_copied():
    """Guards the general case rather than this one file.

    Anything the code reads at import or lifespan time and that lives outside
    `app/` must be copied explicitly. Add the directory here when adding such a
    path, and the Dockerfile will be checked for it.
    """
    required = ["server/scraper/app", "server/scraper/config", "server/scraper/requirements.txt"]
    sources = [s.rstrip("/") for s in _copied_sources()]
    missing = [r for r in required if r not in sources]
    assert not missing, f"not copied into the image: {missing} (COPYs found: {sources})"
