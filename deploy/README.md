# Deployment

NextRole runs on a single Hetzner CX23 VPS (2 vCPU, 4GB RAM, ~$7/mo),
serving two isolated environments from one Docker Compose stack.

| Environment | URL | Auth | Database |
|---|---|---|---|
| Production | `nextrole.cloud` | optional Google sign-in | `job-tracker` / `jobmatch` |

There used to be two rows here: a seeded read-only demo on `nextrole.cloud` and
the real tool on `private.nextrole.cloud` behind Basic Auth. Sign-in replaced
the reason for the split, the demo databases are dropped, and the compose
services that still carried `demo-` names were renamed to `api`/`scraper`/`web`.

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

Under `Identity:Mode=Fixed` (the eval CLIs, or a self-hosted single-user run), this GUID is the answer to
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
- Schedules are UTC, and live in `deploy/systemd/` — **not** in anyone's
  crontab, which holds only the 5-minutely service health check. Three
  one-shot timers, staggered so the two ingests do not contend for the API's
  `discovery` rate-limit bucket (20/min, shared):

      nextrole-mailbot.timer       02:00
      nextrole-pool-ingest.timer   05:30   the shared pool

  `Persistent=true` on both: a timer whose window was missed because the box
  was down fires once on the next boot rather than skipping the day.

  A third timer, `nextrole-ingest.timer`, ran a criteria-driven scrape at 05:00
  into the same pool. Three of its four job titles were already in
  `roles.json`, so `pool_key` deduped the rows while the scrape was paid twice;
  it was removed at teardown and its one unique title ("AI Engineer") moved
  into `roles.json`.

- **`pool-ingest` is what makes the instance usable.** It fills the
  shared job pool the per-user scan matches against; without it a visitor
  uploads a CV and sees an empty Matches tab, because the candidate filter has
  no extracted requirements to filter on. It needs no identity of its own (the
  pool is user-independent) and its three API calls are all on the DemoMode
  allowlist, so it can be scheduled before the instance is flipped to cookie
  identity. First run costs roughly $0.33 in extraction over ~160 postings;
  subsequent runs only pay for what is new (`docs/job-pool.md`).

## Monitoring

Grafana, Loki, and Promtail run as containers on the VPS. Grafana is bound to
localhost only — reach it over an SSH tunnel:

    ssh -fN nextrole          # requires a Host entry in ~/.ssh/config
    # then open http://localhost:3001

Logs are labelled `service` (api, scraper, web, caddy, pool-ingest, mailbot, ...)
and `env`, which is now always `prod`. Filter by `service`:

    {service="api"} |= "jobId=<uuid>"     # one job's full path through the pipeline
    {service="api"} |= "runId=<uuid>"     # everything that happened in one discovery run
    {service="pool-ingest"} |= "Job skipped"

`env` used to distinguish two stacks and got it backwards -- the rule overrode
it to `demo` for any service matching `demo-.*`, which after the repurposing
meant PRODUCTION logs were labelled `env=demo`. Anything filtering `env="prod"`
was reading the private instance (issue #64). The override is gone.

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
    scp deploy/systemd/* root@<host>:/etc/systemd/system/

A new or changed unit needs systemd told about it — copying the file is not
enough:

    systemctl daemon-reload
    systemctl enable --now nextrole-pool-ingest.timer
    systemctl list-timers 'nextrole-*'          # NEXT/LEFT columns confirm it is armed

To check for drift:

    diff <(ssh nextrole 'cat /srv/nextrole/compose.yml') deploy/compose.yml

**`docker compose pull` alone is not enough.** A running container keeps using its old
image until recreated. Always follow with `--force-recreate`, and remember that the
cron-profile containers (`pool-ingest`, `mailbot`) are pulled separately:

    docker compose pull api scraper web
    docker compose up -d --force-recreate api scraper web
    docker compose --profile cron pull pool-ingest mailbot

Verify with `docker inspect -f '{{.State.StartedAt}}' nextrole-api-1`.
