import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './schema/index.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/tkxel_vault',
  idleTimeoutMillis: process.env.NODE_ENV === 'test' ? 1000 : 10000,
  // Connections per service process. Size it so that (services x replicas x DB_POOL_MAX) stays below
  // PostgreSQL's max_connections.
  max: Math.min(Math.max(Number(process.env.DB_POOL_MAX) || 20, 2), 200),
});

export const db = drizzle(pool, { schema });
