# Deploying

`nextrole.cloud` is production and the only deployment. It serves the real
`job-tracker`/`jobmatch` pair behind optional Google sign-in.

Moved out of `AGENTS.md`, which is loaded into every session: this matters on
the few turns you deploy and is noise on the rest. The three properties that
must survive a session where you are *not* deploying stayed behind.

- **`nextrole.cloud` is production, and the only deployment.** It serves the
  real `job-tracker`/`jobmatch` pair behind optional Google sign-in. The compose
  services are `api`, `scraper`, `web` — they were called `demo-api`,
  `demo-scraper`, `demo-client` until the teardown, because they began life
  serving a seeded read-only demo and were repurposed. If you find `demo-`
  anywhere, it is a leftover rather than a second deployment.
  `private.nextrole.cloud` is gone. **`Identity:Mode=Fixed` is not** — the
  golden-set eval CLIs call `identity.instance_identity`, which raises on a
  Cookie instance, so they run against a local `dotnet run` in Fixed mode.
- **Merging to `main` IS the deploy.** Every workflow in `.github/workflows/`
  ends by SSHing to the VPS and running `docker compose pull … && up -d
  --force-recreate`. There is no separate deploy step to forget, and no
  way to merge without shipping. Images are `:latest` built from `main` only, so
  **a branch's images do not exist**: deploying before merging deploys `main`.
- **Config changes are the only manual step**, and they are where the danger is.
  Edit `.env.api` *and* `.env.scraper` before recreating either — the scraper
  resolves sessions out of the API's database, so a window where they disagree
  means every scraper request 401s. `.env.web` is the one people forget: its
  `API_URL`/`SCRAPER_URL` are Docker DNS **service names**, resolved at runtime
  by `client/nginx.conf`, and it is manual config on the box that no `git pull`
  will fix.
- **Atlas credentials are scoped per database pair** (`docs/hosting.md`
  prescribes `readWrite` on exactly two databases, and tells you to verify the
  isolation). **Repointing a database without repointing the credential fails at
  boot**, and the first symptom is misleading: `UserScopeMigrationInitializer`
  issues an unconditional `updateMany` per collection, so it demands write
  privilege even with nothing to migrate and the error names the migration
  rather than the credential (issue #57).
- **Scripts scp'd from a Windows working tree need LF.** The repo's blobs are
  LF, but a working-tree file authored on Windows drifts to CRLF, and `scp`
  copies the working tree -- not the blob. bash then reads `set -euo pipefail
`
  and dies on line 2. For `monitoring/check-services.sh` that means **the
  monitor is dead and an outage produces no alert**: a broken monitor and a
  healthy system look identical from outside, so nothing ever reports it.
  `.gitattributes` pins `*.sh`/`*.yml` to `eol=lf`; after copying anything to
  the box, run it once by hand before trusting it. Go's YAML/JSON readers
  tolerate a trailing `
`, which is why Loki and Grafana came up regardless --
  only the shell scripts actually break.

- **The mailbot must present a session token, and refuses to run without one.**
  It sends `X-Api-Key` (a shared-secret *gate* that selects no user) and
  `X-Source`; neither is an identity. Against the retired Fixed-mode private
  instance that was enough, because identity came from configuration. Against
  `nextrole.cloud` it is not: a Cookie-mode API answers an identity it cannot
  resolve by **minting a fresh anonymous user**, so the sync read an empty
  account and reported `{"Success":true}` -- 115 applications in the database,
  0 seen, two throwaway users minted (issue #67). `Tracker__SessionToken` in
  `.env.mailbot` carries the opaque token (never a userId), provisioned by
  `deploy/mint-mailbot-session.sh`. `TrackerPreflight` then refuses to start
  unless `/api/auth/me` confirms *which* account it resolved to -- reaching the
  API is not reaching the right account, and only the second is worth anything.
  `/api/config` reports `identityMode` so a service client can tell whether a
  token is required at all; an unknown value is treated as Cookie, because
  assuming Fixed is the assumption that fails quietly.

- **The API refuses to start** on a half-configured claim (`Google:ClaimUserId`
  needs `ClaimEmail` and `ClaimExpiresAt`) or an expired one. That is the
  mechanism working, but `restart: unless-stopped` disguises it as a restart
  loop — check `docker compose logs api` for `InvalidOperationException`
  before assuming the deploy hung.

### Verifying a deploy

- **An unproxied `/api/*` route used to return the SPA with a 200.** Routes are
  allowlisted in `client/nginx.conf`; anything unclaimed fell through to
  `try_files … /index.html`, so a missing proxy block failed *invisibly* — no
  404, nothing in logs, and a browser quietly parsing HTML as JSON. `/api/auth`
  and `/api/notices` shipped that way. There is now a catch-all returning a JSON
  404, and **it is load-bearing**: it is what makes the next missing route
  announce itself. Do not remove it. (Inverting the allowlist: issue #55.)
- **Probe with content-type, not status.** It is the only thing that separates
  the three states:

  | Response | Meaning |
  |---|---|
  | `200 text/html` | never left nginx — route not proxied |
  | `404 application/json` | API reached, endpoint missing — **old image** |
  | `200 application/json` | API reached and working |

  `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://nextrole.cloud/api/auth/me`
  — then read the body: `available:false` means the new build is up but sign-in
  is not configured yet.
- **Take a baseline before deploying.** The nginx gap above was caught only
  because the pre-merge reading was `200 text/html` where a 404 was expected.

### Testing gaps a green tick does not cover

- **CI has no MongoDB**, so `UserMergeIntegrationTests` (10 tests) skip via
  `[MongoFact]`. They are the *only* coverage of the re-key, the singleton
  parking and the post-condition leak check — everything the merge does against
  a real database. A green Tests run says the unit tests pass, nothing more
  (issue #54).
- **The e2e suite never runs in CI** either (costs money, drops databases).
- Local development uses Vite's catch-all `/api` proxy, so **no local test can
  catch a missing nginx route** — that only exists in the production image
  (issue #56).

