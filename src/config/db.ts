import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: {
    // Required by Supabase — they use self-signed certificates
    rejectUnauthorized: false,
  },
  max: 10,               // maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ now: Date }>('SELECT NOW()');
    console.log(`✅ Database connected successfully — Server time: ${result.rows[0].now}`);
  } finally {
    client.release();
  }
}
