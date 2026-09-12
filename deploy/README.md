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

## Multi-user migration — read before the first deploy of this build

Both services migrate pre-multi-user data on startup, and **both must run**.
The API stamps `userId` onto the tracker collections and re-keys the
one-per-user singletons; the scraper rebuilds the retention TTL, stamps
`search_criteria`, and creates the pool indexes. Each refuses to start if its
own migration cannot complete — the API because it would otherwise serve a
view of the database that does not match what is in it, the scraper because
until its TTL rebuild lands every shared-pool job is a deletion candidate under
the old unfiltered index. Full detail: `docs/multi-user.md`, `docs/job-pool.md`.

### `Identity:FixedUserId` is set once and cannot be changed afterwards

On `private.nextrole.cloud` (`Identity:Mode=Fixed`), this GUID is the answer to
"who owns all the existing data". The first startup stamps every pre-multi-user
document with it and re-keys the profile and résumé file onto it.

**Changing it later orphans everything.** The previous owner's rows stay in the
database under the old id, and the instance comes up looking empty — the data
is intact but unreachable without a second, hand-written migration. Decide the
value before the first boot and keep it in the environment file for good.

> The pre-deploy rehearsal was run with the `appsettings.json` default
> `11111111-1111-1111-1111-111111111111`. If production deploys with a
> different GUID, the rehearsal still holds — the id is a parameter, not a
> behaviour — but the deployed value is the one that becomes permanent.

### Rehearse against a copy first

```bash
# Copy production (documents AND index definitions) to a scratch name
dotnet run --project server/api/src/DbCopy -- job-tracker=job-tracker-rehearsal
dotnet run --project server/api/src/DbCopy -- jobmatch=jobmatch-rehearsal

# Point a local API + scraper at the copy and watch the startup logs, then
# boot a second time: a correct migration logs nothing at all on the rerun.
```

Copying the index definitions is the point: the migration drops and rebuilds
the legacy unique indexes, and a document-only copy silently skips half the
test. Drop the copies afterwards — a full copy of production roughly doubles
cluster storage, which matters on the M0 free tier.

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

The mailbot's `sleep 20` is deliberate: the container otherwise exits
in about a second, faster than promtail's container-discovery interval,
and its logs never reach Loki.    

### Gotchas

**The mailbot's `sleep 20` is deliberate.** Its container otherwise exits in about a
second — faster than promtail's container-discovery interval — and its logs never
reach Loki. The `entrypoint: sh -c "dotnet Mailbot.dll; sleep 20"` line in
`compose.yml` keeps the container alive long enough to be scraped. Don't remove it.

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
