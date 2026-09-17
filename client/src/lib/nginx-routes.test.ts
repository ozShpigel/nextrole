import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every /api/match path the client calls must be proxied by nginx.conf.
 *
 * The public config allowlists sub-paths explicitly rather than proxying the
 * /api/match prefix, and deliberately so: a prefix would also expose
 * title-triage, seniority-classify and discovery-score-batch — scraper-internal
 * AI-calling routes with much looser input caps, reachable with no auth on a
 * real billed key. Its comment says a new client-facing route "needs adding
 * here too, on purpose, not for free."
 *
 * That comment was a rule with nothing behind it, and pool-scan shipped without
 * the entry. nginx answered the POST with 405 — a POST to the SPA's static
 * try_files fallback — so the Matches tab read "Couldn't score the job pool:
 * HTTP 405" on the public instance while every local and private path worked,
 * because those use a plain prefix.
 */
const CLIENT = resolve(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Literal first arguments to matchApi(...), as written in the source. */
function calledPaths(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(join(CLIENT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/matchApi\(\s*[`'"]([^`'"]*)[`'"]/g)) {
      // A template literal with an interpolation is not a fixed route; the
      // proxied prefix is whatever precedes the first ${.
      found.add(m[1]);
    }
  }
  return [...found];
}

/** Literal first arguments to poolApi(...), as written in the source. */
function poolPaths(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(join(CLIENT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/poolApi\(\s*[`'"]([^`'"]*)/g)) found.add(m[1]);
  }
  return [...found];
}

function allowedPaths(): string[] {
  const conf = readFileSync(join(CLIENT, 'nginx.conf'), 'utf8');
  const m = conf.match(/location ~ \^\/api\/match\(([^)]*)\)\$/);
  if (!m) throw new Error('nginx.conf: the /api/match location is not the expected alternation');
  return m[1].split('|');
}

describe('nginx.conf proxies what the client calls', () => {
  it('allows every /api/match path matchApi() uses', () => {
    const allowed = allowedPaths();
    const missing = calledPaths().filter((p) => !allowed.includes(p));
    expect(missing, `not proxied by client/nginx.conf — these 405 on the public instance`).toEqual([]);
  });

  it('finds the routes at all (guards the extraction itself)', () => {
    // A vacuous pass is the failure mode this whole test would otherwise have:
    // a regex that matches nothing reports no missing routes.
    const called = calledPaths();
    expect(called.length).toBeGreaterThan(3);
    expect(called).toContain('/pool-scan');
  });

  it('proxies the /api/pool prefix poolApi() uses', () => {
    // poolApi() went to a prefix of its own rather than staying under
    // /api/discovery, so it needs a location block of its own. Without one it
    // falls to the catch-all and every save/dismiss/view/unsave returns a JSON
    // 404 -- better than the SPA-with-200 that /api/auth once returned, but
    // still a dead Matches page.
    const conf = readFileSync(join(CLIENT, 'nginx.conf'), 'utf8');
    const called = poolPaths();

    expect(called.length, 'poolApi() call sites not found -- the extraction is broken').toBeGreaterThan(2);
    expect(
      /location \/api\/pool[\s{]/.test(conf),
      'client/nginx.conf has no /api/pool block, so these are unroutable: ' + called.join(', '),
    ).toBe(true);
  });

  it('sends /api/pool to the API, not the scraper', () => {
    // The whole reason these moved. Pointing the block at $upstream_scraper
    // would reach a service that no longer implements them.
    const conf = readFileSync(join(CLIENT, 'nginx.conf'), 'utf8');
    const block = conf.match(/location \/api\/pool[\s{][^{]*\{([^}]*)\}/);
    expect(block, 'no /api/pool location block to check').not.toBeNull();
    expect(block![1]).toContain('$upstream_api');
    expect(block![1]).not.toContain('$upstream_scraper');
  });

  it('does not allow the scraper-internal AI routes', () => {
    const allowed = allowedPaths();
    for (const internal of ['/title-triage', '/seniority-classify', '/discovery-score-batch', '/job-facts']) {
      expect(allowed, `${internal} must not be reachable from a browser`).not.toContain(internal);
    }
  });
});
