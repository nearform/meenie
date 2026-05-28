import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appliedRows = await pool.query<{ name: string }>(
    "SELECT name FROM _migrations",
  );
  const applied = new Set(appliedRows.rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[skip] ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`[ok]   ${file}`);
      appliedCount += 1;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[fail] ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`Done. Applied ${appliedCount} new migration(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
