import pg from "pg";
import { config } from "./config.ts";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/**
 * Typed query helper. Returns rows only.
 *
 * Frozen contract: parallel agents must use this helper instead of touching
 * the pool directly so we have a single seam for tracing / metrics later.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as unknown[] | undefined);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
