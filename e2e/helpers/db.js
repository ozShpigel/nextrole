import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConnectionString() {
  const envPath = resolve(__dirname, '../../server/api/src/Api/.env');
  try {
    const text = readFileSync(envPath, 'utf-8');
    const match = text.match(/MongoDB__ConnectionString=(.+)/);
    if (match) return match[1].trim();
  } catch { /* fall through */ }
  return process.env.MONGODB_CONNECTION_STRING || process.env.MongoDB__ConnectionString;
}

const DB_NAME = 'job-tracker-test';
let _client;

export async function getDb() {
  if (!_client) {
    _client = new MongoClient(loadConnectionString());
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

export async function closeDb() {
  if (_client) {
    await _client.close();
    _client = null;
  }
}

export async function clearCollection(name) {
  const db = await getDb();
  await db.collection(name).deleteMany({});
}

export async function clearAll() {
  const db = await getDb();
  await Promise.all([
    db.collection('search_criteria').deleteMany({}),
    db.collection('discovery_runs').deleteMany({}),
    db.collection('discovered_jobs').deleteMany({}),
  ]);
}

export async function insertCriteria(overrides = {}) {
  const db = await getDb();
  const doc = {
    id: crypto.randomUUID(),
    name: 'Test Criteria',
    job_titles: ['Software Engineer'],
    locations: ['Tel Aviv'],
    site_names: ['linkedin'],
    results_wanted: 15,
    hours_old: 72,
    country: 'Israel',
    is_remote: null,
    min_score_to_save: 70,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  await db.collection('search_criteria').insertOne(doc);
  return doc;
}

export async function insertRun(overrides = {}) {
  const db = await getDb();
  const doc = {
    id: crypto.randomUUID(),
    criteria_id: crypto.randomUUID(),
    criteria_name: 'Test Criteria',
    status: 'completed',
    started_at: new Date(),
    completed_at: new Date(),
    jobs_scraped: 5,
    jobs_scored: 4,
    jobs_saved: 2,
    jobs_skipped_duplicate: 1,
    error: null,
    ...overrides,
  };
  await db.collection('discovery_runs').insertOne(doc);
  return doc;
}

export async function insertJob(overrides = {}) {
  const db = await getDb();
  const doc = {
    id: crypto.randomUUID(),
    run_id: crypto.randomUUID(),
    criteria_id: crypto.randomUUID(),
    title: 'Backend Engineer',
    company: 'TestCorp',
    location: 'Tel Aviv',
    description: 'A '.repeat(30) + 'long job description for a backend engineer role requiring Node.js, Python, and AWS experience.',
    job_url: 'https://example.com/job/123',
    date_posted: '2026-05-01',
    site: 'linkedin',
    score: 75,
    verdict: 'YES',
    should_apply: true,
    match_analysis: {
      overallScore: 75,
      verdict: 'YES',
      breakdown: {
        technical: { score: 28, maxScore: 35, strengths: ['Node.js match'], gaps: ['No Python'] },
        cultural: { score: 25, maxScore: 35, positiveSignals: ['Async culture'], concerns: [] },
        roleCharacteristics: { score: 22, maxScore: 30, opportunities: ['Growth'], risks: [] },
      },
      recommendation: {
        shouldApply: true,
        keyReasons: ['Strong technical fit'],
        questionsToAsk: ['Team size?'],
        redFlags: [],
        greenFlags: ['Great stack match'],
      },
      honestAssessment: 'Overall good match with growth potential.',
    },
    company_news: null,
    glassdoor_data: null,
    is_duplicate: false,
    saved_to_tracker: false,
    dismissed: false,
    discovered_at: new Date(),
    ...overrides,
  };
  await db.collection('discovered_jobs').insertOne(doc);
  return doc;
}
