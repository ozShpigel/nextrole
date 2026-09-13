---
name: private-nginx-timeout-parity
description: nginx.private.conf's /api/match prefix block has no proxy_read_timeout override, unlike the public nginx.conf's dedicated pool-scan location — private.nextrole.cloud can 504 on a scan the public/demo instance handles fine, confirmed 2026-09-13
type: project
---

`client/nginx.conf` (public) has a dedicated `location = /api/match/pool-scan`
block with `proxy_send_timeout 300s` / `proxy_read_timeout 300s`, added
specifically because a pool scan runs several ~80s Claude batches and
nginx's 60s default was killing the request while the API kept working.

`client/nginx.private.conf` never got the same fix: it only has a prefix
`location /api/match { ... }` (adds `X-Api-Key`, no timeout directives), so
it inherits nginx's 60s default for `proxy_read_timeout`. Confirmed by
reading both files directly — the private config's only two
`proxy_read_timeout` overrides are on `/api/discovery` locations, not
`/api/match`.

**Why:** private.nextrole.cloud is the owner's own primary deployment. A
scan that takes >60s (any scan touching more than ~1 round of batches)
504s there while working fine on the public demo — the opposite of the
usual "works in dev, breaks in the demo" failure mode this project usually
watches for.

**How to apply:** any time a public `nginx.conf` location gets a new
timeout/header override, check whether `nginx.private.conf`'s corresponding
(often broader-prefix) location needs the same override. There's no
automated parity check between the two files today — `nginx-routes.test.ts`
only asserts path coverage, not directive parity.
