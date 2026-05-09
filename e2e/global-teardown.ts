import { closeDb } from './fixtures/helpers';

export default async function globalTeardown(): Promise<void> {
  await closeDb();
}
