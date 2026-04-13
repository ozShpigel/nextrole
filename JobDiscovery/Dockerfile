FROM python:3.12-slim

WORKDIR /app

COPY JobDiscovery/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY JobDiscovery/app/ ./app/

# Copy professional profile from JobMatchService at build time
COPY JobMatchService/Data/professional-profile.md ./app/data/professional-profile.md

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
