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
