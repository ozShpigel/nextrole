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

// ── Tracker helpers ──────────────────────────────────────────────

export interface ApplicationDoc {
  _id: string;
  JobTitle: string;
  Company: string;
  Status: string;
  MatchScore: number | null;
  MatchVerdict: string | null;
  JobDescription: string | null;
  MatchAnalysis: string | null;
  AnalystSnapshotInput: string | null;
  AnalystSnapshotOutput: string | null;
  EvaluatorSnapshotInput: string | null;
  EvaluatorSnapshotOutput: string | null;
  CompanyNews: string | null;
  GlassdoorData: string | null;
  CompanySummary: string | null;
  Salary: string | null;
  CreatedAt: Date;
  AppliedAt: Date | null;
  UpdatedAt: Date;
}

export async function insertApplication(overrides: Partial<ApplicationDoc> = {}): Promise<ApplicationDoc> {
  const db = await getDb();
  const doc: ApplicationDoc = {
    _id: crypto.randomUUID(),
    JobTitle: 'Backend Engineer',
    Company: 'TestCorp',
    Status: 'Applied',
    MatchScore: 82,
    MatchVerdict: 'YES',
    JobDescription: 'A test job description for backend engineer.',
    MatchAnalysis: null,
    AnalystSnapshotInput: null,
    AnalystSnapshotOutput: null,
    EvaluatorSnapshotInput: null,
    EvaluatorSnapshotOutput: null,
    CompanyNews: null,
    GlassdoorData: null,
    CompanySummary: null,
    Salary: null,
    CreatedAt: new Date(),
    AppliedAt: new Date(),
    UpdatedAt: new Date(),
    ...overrides,
  };
  await db.collection('applications').insertOne(doc);
  return doc;
}

export interface InterviewDoc {
  _id: string;
  ApplicationId: string;
  ScheduledAt: Date;
  Type: string;
  Interviewer: string | null;
  Topics: string | null;
  Notes: string | null;
  Completed: boolean;
  CreatedAt: Date;
  // Structured retro, captured when Completed flips to true. RetroRating
  // presence is the "has a retro" predicate the /interview-insights/retros
  // endpoint filters on — the rest is optional.
  RetroRating?: number | null;
  RetroWentWell?: string | null;
  RetroToImprove?: string | null;
  RetroCategories?: string[];
}

export async function insertInterview(overrides: Partial<InterviewDoc> = {}): Promise<InterviewDoc> {
  const db = await getDb();
  const doc: InterviewDoc = {
    _id: crypto.randomUUID(),
    ApplicationId: '',
    ScheduledAt: new Date(Date.now() + 86400000),
    Type: 'Technical',
    Interviewer: null,
    Topics: null,
    Notes: null,
    Completed: false,
    CreatedAt: new Date(),
    RetroRating: null,
    RetroWentWell: null,
    RetroToImprove: null,
    RetroCategories: [],
    ...overrides,
  };
  await db.collection('interviews').insertOne(doc);
  return doc;
}

export interface NoteDoc {
  _id: string;
  ApplicationId: string;
  Content: string;
  Category: string | null;
  CreatedAt: Date;
}

export async function insertNote(overrides: Partial<NoteDoc> = {}): Promise<NoteDoc> {
  const db = await getDb();
  const doc: NoteDoc = {
    _id: crypto.randomUUID(),
    ApplicationId: '',
    Content: 'Test note content',
    Category: null,
    CreatedAt: new Date(),
    ...overrides,
  };
  await db.collection('notes').insertOne(doc);
  return doc;
}

export interface StatusUpdateDoc {
  _id: string;
  ApplicationId: string;
  FromStatus: string;
  ToStatus: string;
  Note: string | null;
  Timestamp: Date;
}

export async function insertStatusUpdate(overrides: Partial<StatusUpdateDoc> = {}): Promise<StatusUpdateDoc> {
  const db = await getDb();
  const doc: StatusUpdateDoc = {
    _id: crypto.randomUUID(),
    ApplicationId: '',
    FromStatus: 'Analyzing',
    ToStatus: 'Applied',
    Note: null,
    Timestamp: new Date(),
    ...overrides,
  };
  await db.collection('statusUpdates').insertOne(doc);
  return doc;
}
