import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './schema/index.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/tkxel_vault',
  idleTimeoutMillis: process.env.NODE_ENV === 'test' ? 1000 : 10000,
});

export const db = drizzle(pool, { schema });
