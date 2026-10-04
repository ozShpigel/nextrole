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

The API migrates pre-multi-user data on startup: it stamps `userId` onto the
tracker collections and re-keys the one-per-user singletons, and refuses to
start if that cannot complete, because it would otherwise serve a view of the
database that does not match what is in it. Full detail: `docs/multi-user.md`.
(The shared-pool TTL rebuild that also ran here went with the LinkedIn pool,
removed 2026-10-04.)

## Notes


- `nginx/*.conf.template` override the images' baked-in `resolver 8.8.8.8`
  with Docker's internal DNS (`127.0.0.11`). Without this, nginx cannot
  resolve sibling container names.
- Frontend API URLs are Vite build-time variables. They must be unset in
  GitHub Actions variables so the code falls back to relative paths.
- Schedules are UTC, and live in `deploy/systemd/` — **not** in anyone's
  crontab, which holds only the 5-minutely service health check. Two
  one-shot timers:

      nextrole-mailbot.timer       02:00
      nextrole-greenhouse.timer    06:15   the board ingest's fan-out

  `Persistent=true` on both: a timer whose window was missed because the box
  was down fires once on the next boot rather than skipping the day.

  `nextrole-pool-ingest.timer` (05:30, the LinkedIn pool) was disabled on
  2026-09-26 and its unit and image removed on 2026-10-04. On the box:
  `systemctl disable --now nextrole-pool-ingest.timer` if it is still
  enabled, then delete both unit files and run `systemctl daemon-reload`.

- **`greenhouse` (the publish cron) and `greenhouse-consumer` are what make the instance
  usable.** They fill `greenhouse_jobs`, the pool the per-user scan matches
  against (`docs/greenhouse.md`).

## Monitoring

Grafana, Loki, and Promtail run as containers on the VPS. Grafana is bound to
localhost only — reach it over an SSH tunnel:

    ssh -N nextrole           # foreground; Ctrl+C closes the tunnel
    ssh -fN nextrole          # or backgrounded
    # then open http://localhost:3001

`nextrole` is a Host entry in `~/.ssh/config` (WSL), and the forwards live
there rather than on the command line:

    Host nextrole
        HostName 62.238.100.118
        User root
        LocalForward 3001 127.0.0.1:3001     # Grafana
        LocalForward 15672 127.0.0.1:15672   # RabbitMQ management (optional)

Log in to Grafana as `admin` with `GRAFANA_PASSWORD` from the box's `.env`.

Logs are labelled `service` (api, scraper, web, caddy, mailbot, greenhouse-consumer, ...)
and `env`, which is now always `prod`. Filter by `service`:

    {service="api"} |= "jobId=<uuid>"     # one job's full path through the pipeline
    {service="greenhouse-consumer"} |= "Board"   # one ingest run's per-board lines

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
    systemctl enable --now nextrole-greenhouse.timer
    systemctl list-timers 'nextrole-*'          # NEXT/LEFT columns confirm it is armed

To check for drift:

    diff <(ssh nextrole 'cat /srv/nextrole/compose.yml') deploy/compose.yml

**`docker compose pull` alone is not enough.** A running container keeps using its old
image until recreated. Always follow with `--force-recreate`, and remember that the
cron-profile containers (`mailbot`, `greenhouse`) are pulled separately:

    docker compose pull api scraper web
    docker compose up -d --force-recreate api scraper web
    docker compose --profile cron pull mailbot greenhouse

Verify with `docker inspect -f '{{.State.StartedAt}}' nextrole-api-1`.
