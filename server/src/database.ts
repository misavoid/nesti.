import pg from "pg";
import { databaseConfig } from "./config.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  return new Pool(databaseConfig());
}

export async function withTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((error as { code?: string }).code !== "40001" || attempt === attempts) throw error;
    } finally {
      client.release();
    }
  }
  throw new Error("Transaction retry loop exhausted.");
}
