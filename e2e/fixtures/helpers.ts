import { MongoClient, type Db } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConnectionString(): string {
  const envPath = resolve(__dirname, '../.env.test');
  try {
    const text = readFileSync(envPath, 'utf-8');
    const match = text.match(/MongoDB__ConnectionString=(.+)/);
    if (match) return match[1].trim();
  } catch { /* fall through */ }
  return process.env.MONGODB_CONNECTION_STRING || process.env.MongoDB__ConnectionString || '';
}

const DB_NAME = 'job-tracker-test';
let _client: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  if (!_client) {
    _client = new MongoClient(loadConnectionString());
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}

export async function clearCollection(name: string): Promise<void> {
  const db = await getDb();
  await db.collection(name).deleteMany({});
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection('search_criteria').deleteMany({}),
    db.collection('discovery_runs').deleteMany({}),
    db.collection('discovered_jobs').deleteMany({}),
    db.collection('applications').deleteMany({}),
    db.collection('interviews').deleteMany({}),
    db.collection('notes').deleteMany({}),
    db.collection('statusUpdates').deleteMany({}),
  ]);
}

export interface CriteriaDoc {
  id: string;
  name: string;
  job_titles: string[];
  locations: string[];
  site_names: string[];
  results_wanted: number;
  hours_old: number;
  country: string;
  is_remote: boolean | null;
  min_score_to_save: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function insertCriteria(overrides: Partial<CriteriaDoc> = {}): Promise<CriteriaDoc> {
  const db = await getDb();
  const doc: CriteriaDoc = {
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

export interface RunDoc {
  id: string;
  criteria_id: string;
  criteria_name: string;
  status: string;
  started_at: Date;
  completed_at: Date | null;
  jobs_scraped: number;
  jobs_scored: number;
  jobs_saved: number;
  jobs_skipped_duplicate: number;
  error: string | null;
}

export async function insertRun(overrides: Partial<RunDoc> = {}): Promise<RunDoc> {
  const db = await getDb();
  const doc: RunDoc = {
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

interface MatchBreakdown {
  technical: { score: number; maxScore: number; strengths: string[]; gaps: string[] };
  cultural: { score: number; maxScore: number; positiveSignals: string[]; concerns: string[] };
  roleCharacteristics: { score: number; maxScore: number; opportunities: string[]; risks: string[] };
}

interface MatchRecommendation {
  shouldApply: boolean;
  keyReasons: string[];
  questionsToAsk: string[];
  redFlags: string[];
  greenFlags: string[];
}

interface MatchAnalysis {
  overallScore: number;
  verdict: string;
  breakdown: MatchBreakdown;
  recommendation: MatchRecommendation;
  honestAssessment: string;
}

interface GlassdoorData {
  rating: number;
  reviewCount: number;
  url: string | null;
}

interface NewsItem {
  title: string;
  source: string;
}

export interface JobDoc {
  id: string;
  run_id: string;
  criteria_id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  job_url: string;
  date_posted: string;
  site: string;
  score: number | null;
  verdict: string | null;
  should_apply: boolean | null;
  match_analysis: MatchAnalysis | null;
  company_news: NewsItem[] | null;
  glassdoor_data: GlassdoorData | null;
  honest_assessment?: string | null;
  key_strengths?: string[] | null;
  key_concerns?: string[] | null;
  evaluator_snapshot_input?: string | null;
  evaluator_snapshot_output?: string | null;
  analyst_snapshot_input?: string | null;
  analyst_snapshot_output?: string | null;
  is_duplicate: boolean;
  saved_to_tracker: boolean;
  dismissed: boolean;
  discovered_at: Date;
}

export async function insertJob(overrides: Partial<JobDoc> = {}): Promise<JobDoc> {
  const db = await getDb();
  const doc: JobDoc = {
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

// ── Tracker helpers ──────────────────────────────────────────────

export interface ApplicationDoc {
  _id: string;
  jobTitle: string;
  company: string;
  status: string;
  matchScore: number | null;
  matchVerdict: string | null;
  jobDescription: string | null;
  matchAnalysis: string | null;
  analystSnapshotInput: string | null;
  analystSnapshotOutput: string | null;
  evaluatorSnapshotInput: string | null;
  evaluatorSnapshotOutput: string | null;
  companyNews: string | null;
  glassdoorData: string | null;
  companySummary: string | null;
  salary: string | null;
  createdAt: Date;
  appliedAt: Date | null;
  updatedAt: Date;
}

export async function insertApplication(overrides: Partial<ApplicationDoc> = {}): Promise<ApplicationDoc> {
  const db = await getDb();
  const doc: ApplicationDoc = {
    _id: crypto.randomUUID(),
    jobTitle: 'Backend Engineer',
    company: 'TestCorp',
    status: 'Applied',
    matchScore: 82,
    matchVerdict: 'YES',
    jobDescription: 'A test job description for backend engineer.',
    matchAnalysis: null,
    analystSnapshotInput: null,
    analystSnapshotOutput: null,
    evaluatorSnapshotInput: null,
    evaluatorSnapshotOutput: null,
    companyNews: null,
    glassdoorData: null,
    companySummary: null,
    salary: null,
    createdAt: new Date(),
    appliedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  await db.collection('applications').insertOne(doc);
  return doc;
}

export interface InterviewDoc {
  _id: string;
  applicationId: string;
  scheduledAt: Date;
  type: string;
  interviewer: string | null;
  topics: string | null;
  notes: string | null;
  feedback: string | null;
  completed: boolean;
  createdAt: Date;
}

export async function insertInterview(overrides: Partial<InterviewDoc> = {}): Promise<InterviewDoc> {
  const db = await getDb();
  const doc: InterviewDoc = {
    _id: crypto.randomUUID(),
    applicationId: '',
    scheduledAt: new Date(Date.now() + 86400000),
    type: 'Technical',
    interviewer: null,
    topics: null,
    notes: null,
    feedback: null,
    completed: false,
    createdAt: new Date(),
    ...overrides,
  };
  await db.collection('interviews').insertOne(doc);
  return doc;
}

export interface NoteDoc {
  _id: string;
  applicationId: string;
  content: string;
  category: string | null;
  createdAt: Date;
}

export async function insertNote(overrides: Partial<NoteDoc> = {}): Promise<NoteDoc> {
  const db = await getDb();
  const doc: NoteDoc = {
    _id: crypto.randomUUID(),
    applicationId: '',
    content: 'Test note content',
    category: null,
    createdAt: new Date(),
    ...overrides,
  };
  await db.collection('notes').insertOne(doc);
  return doc;
}

export interface StatusUpdateDoc {
  _id: string;
  applicationId: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  timestamp: Date;
}

export async function insertStatusUpdate(overrides: Partial<StatusUpdateDoc> = {}): Promise<StatusUpdateDoc> {
  const db = await getDb();
  const doc: StatusUpdateDoc = {
    _id: crypto.randomUUID(),
    applicationId: '',
    fromStatus: 'Analyzing',
    toStatus: 'Applied',
    note: null,
    timestamp: new Date(),
    ...overrides,
  };
  await db.collection('statusUpdates').insertOne(doc);
  return doc;
}
