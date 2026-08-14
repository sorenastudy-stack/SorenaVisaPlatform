/**
 * PR-TEST-ISOLATION — point this worker at its own schema.
 *
 * MUST run in `setupFiles`, not `setupFilesAfterEach`/`setupFilesAfterEnv`:
 * specs construct a PrismaClient at module load, and the client reads
 * DATABASE_URL when it is constructed. Rewriting the variable any later would
 * leave every already-imported client pointed at the shared database — which is
 * the exact bug this is meant to remove, reintroduced silently.
 */
import * as dotenv from 'dotenv';
import { schemaForWorker, urlWithSchema } from './db-schema';

dotenv.config();

const base = process.env.DATABASE_URL;
if (base) {
  process.env.DATABASE_URL = urlWithSchema(base, schemaForWorker(process.env.JEST_WORKER_ID));
}
