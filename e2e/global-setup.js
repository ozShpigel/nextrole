import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadConnectionString() {
  const envPath = resolve(import.meta.dirname, '../server/api/src/Api/.env');
  try {
    const text = readFileSync(envPath, 'utf-8');
    const match = text.match(/MongoDB__ConnectionString=(.+)/);
    if (match) return match[1].trim();
  } catch { /* fall through */ }

  return process.env.MONGODB_CONNECTION_STRING || process.env.MongoDB__ConnectionString;
}

const TEST_DBS = ['job-tracker-test', 'jobmatch-test'];

export default async function globalSetup() {
  const uri = loadConnectionString();
  if (!uri) {
    console.warn('[global-setup] No MongoDB connection string found — skipping DB cleanup');
    return;
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    for (const dbName of TEST_DBS) {
      await client.db(dbName).dropDatabase();
      console.log(`[global-setup] Dropped database: ${dbName}`);
    }
  } finally {
    await client.close();
  }
}
