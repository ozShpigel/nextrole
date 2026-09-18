FROM python:3.12-slim

WORKDIR /app

COPY server/scraper/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/scraper/app/ ./app/

# No config/ any more: the role list belongs to PoolIngest, which is the only
# thing that reads it (docs/scraper-slimming.md, Phase 3d). This service is
# handed its search parameters in the request body and knows nothing about
# which roles the pool covers.

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
