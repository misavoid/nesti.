import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./database.js";
import { runtimeDatabasePassword } from "./config.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(root, "migrations");
const pool = createPool();

async function migrate(): Promise<void> {
  const client = await pool.connect();
  let migrationLockHeld = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('nesti_sync_migrations'))");
    migrationLockHeld = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
      if (existing.rowCount) continue;
      const sql = await readFile(join(migrationsDirectory, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        process.stdout.write(`Applied migration ${name}.\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const quoted = await client.query<{ value: string }>("SELECT quote_literal($1) AS value", [runtimeDatabasePassword()]);
    const password = quoted.rows[0]?.value;
    if (!password) throw new Error("Could not quote the runtime database password.");
    await client.query(`DO $$ BEGIN CREATE ROLE nesti_api LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query(`ALTER ROLE nesti_api PASSWORD ${password}`);
    await client.query("GRANT USAGE ON SCHEMA public TO nesti_api");
    await client.query("GRANT SELECT ON schema_migrations TO nesti_api");
    await client.query("GRANT SELECT, INSERT, UPDATE ON homes, devices, pairing_codes, profiles, rooms, tasks, completion_records TO nesti_api");
    await client.query("GRANT SELECT, INSERT ON change_log, applied_mutations TO nesti_api");
    await client.query("GRANT USAGE, SELECT ON SEQUENCE sync_cursor_sequence TO nesti_api");
  } finally {
    if (migrationLockHeld) await client.query("SELECT pg_advisory_unlock(hashtext('nesti_sync_migrations'))").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
