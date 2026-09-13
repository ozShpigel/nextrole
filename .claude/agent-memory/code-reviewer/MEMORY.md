# Memory Index

- [Stale-disclosure pattern duplication](stale_disclosure_pattern_duplication.md) — ActivePage.tsx / ApplicationList.tsx both hand-roll the same "gone quiet" disclosure; divergence has grown from wording to full markup/visual treatment
- [Design system doc drift](design_system_doc_drift.md) — docs/design-system.md's STATUS_TONE claim is false, "two font weights" rule is pervasively unmet, nginx.conf has stale Render-era comments
- [Effect guard resets on failure](effect-guard-resets-on-failure.md) — a useState effect-guard reset in .finally() on error self-retries a billed AI call with no user action; check catch/finally, not just StrictMode
- [Private nginx timeout parity](private-nginx-timeout-parity.md) — nginx.private.conf's /api/match block lacks the pool-scan proxy_read_timeout the public nginx.conf has; private deploy can 504 where public doesn't
