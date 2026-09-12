FROM python:3.12-slim

WORKDIR /app

COPY server/scraper/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/scraper/app/ ./app/
# The shared pool's role list. Configuration, not code (docs/job-pool.md), but
# still part of the image: app.roles.load() is fatal without it, so an image
# built without this line starts, migrates, and then exits on the first
# lifespan hook. ROLES_CONFIG_PATH can point elsewhere at runtime; this is the
# default the code looks for.
COPY server/scraper/config/ ./config/

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
