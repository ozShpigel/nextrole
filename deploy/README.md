# Deployment

NextRole runs on a single Hetzner CX23 VPS (2 vCPU, 4GB RAM, ~$7/mo),
serving two isolated environments from one Docker Compose stack.

| Environment | URL | Auth | Database |
|---|---|---|---|
| Demo | `nextrole.cloud` | none | demo DB |
| Production | `private.nextrole.cloud` | Basic Auth | prod DB |

## Architecture

Caddy is the only container exposed to the internet (ports 80/443). It
routes by hostname and manages TLS certificates automatically via
Let's Encrypt. All application containers communicate over Compose's
internal network and publish no ports.

Each environment runs its own `api`, `scraper`, and `client` from the
same images, differentiated by environment file. Images are built in
GitHub Actions and pulled from GHCR — nothing is built on the server.

Scheduled jobs run as systemd timers rather than always-on containers.

## Setup

1. Provision the server, attach a firewall allowing 22/80/443 only
2. Install Docker, configure log rotation in `/etc/docker/daemon.json`
3. Copy this directory to `/srv/nextrole`
4. Create `.env.*` files from `.env.example` (never commit these)
5. Generate `.htpasswd`: `docker run --rm httpd:alpine htpasswd -nbB <user> <pass>`
6. Point DNS A records at the server IP
7. `docker compose up -d`
8. Install timers: `cp systemd/* /etc/systemd/system/ && systemctl enable --now nextrole-*.timer`

## Notes

- `nginx/*.conf.template` override the images' baked-in `resolver 8.8.8.8`
  with Docker's internal DNS (`127.0.0.11`). Without this, nginx cannot
  resolve sibling container names.
- Frontend API URLs are Vite build-time variables. They must be unset in
  GitHub Actions variables so the code falls back to relative paths.
- Cron schedules are UTC.

## Monitoring

Grafana, Loki, and Promtail run as containers on the VPS. Grafana is bound to
localhost only — reach it over an SSH tunnel:

    ssh -fN nextrole          # requires a Host entry in ~/.ssh/config
    # then open http://localhost:3001

Logs are labelled `env` (prod/demo) and `service` (api, scraper, ingest, caddy, ...).
Useful queries:

    {env="prod"} |= "jobId=<uuid>"     # one job's full path through the pipeline
    {env="prod"} |= "runId=<uuid>"     # everything that happened in one discovery run
    {service="ingest"} |= "Job skipped"

### Gotchas

**Mailbot logs are not in Grafana.** Its container runs for about a second, which is
shorter than promtail's 15s container-discovery interval, so promtail usually never
sees it. Use `journalctl -u nextrole-mailbot.service` instead.

**Restart promtail before the run you want to inspect.** Promtail does not collect
retroactively — logs written before a config change or restart are lost to Loki even
though they remain in journald.

**`deploy/` is not synced to the server by CI.** The GitHub Actions workflows build
images and run `docker compose pull` / `up`, but never copy `compose.yml`, the
monitoring configs, or the systemd units. After changing anything under `deploy/`,
copy it manually:

    scp deploy/compose.yml root@<host>:/srv/nextrole/
    scp deploy/monitoring/*.yml root@<host>:/srv/nextrole/monitoring/

To check for drift:

    diff <(ssh nextrole 'cat /srv/nextrole/compose.yml') deploy/compose.yml

**`docker compose pull` alone is not enough.** A running container keeps using its old
image until recreated. Always follow with `--force-recreate`, and remember that the
cron-profile containers (`ingest`, `mailbot`) are pulled separately:

    docker compose pull api scraper
    docker compose up -d --force-recreate api scraper
    docker compose --profile cron pull ingest mailbot

Verify with `docker inspect -f '{{.State.StartedAt}}' nextrole-api-1`.
