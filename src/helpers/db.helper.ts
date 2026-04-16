import { QueryResult, QueryResultRow } from 'pg';
import { pool } from '../config/db';

/**
 * Executes a SQL query and returns all matching rows typed as T[].
 *
 * @example
 * const users = await query<User>('SELECT * FROM users WHERE company_id = $1', [companyId]);
 */
export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result: QueryResult<T> = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * Executes a SQL query and returns the first row typed as T, or null if no rows found.
 * Useful for SELECT by ID or unique field lookups.
 *
 * @example
 * const user = await queryOne<User>('SELECT * FROM users WHERE email = $1', [email]);
 */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result: QueryResult<T> = await pool.query<T>(text, params);
  return result.rows[0] ?? null;
}
