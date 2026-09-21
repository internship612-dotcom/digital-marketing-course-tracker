import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(here, "../.local/pgdata");
const port = Number(process.env.DB_PORT ?? 5433);
const user = process.env.DB_USER ?? "postgres";
const password = process.env.DB_PASSWORD ?? "postgres";
const database = process.env.DB_NAME ?? "course_tracker";

const pg = new EmbeddedPostgres({
  databaseDir,
  port,
  user,
  password,
  persistent: true,
  timeout: 180000,
});

console.log(`[db] data dir:   ${databaseDir}`);
console.log(`[db] listener:   localhost:${port}`);

if (!fs.existsSync(path.join(databaseDir, "PG_VERSION"))) {
  await pg.initialise();
  console.log("[db] initialised cluster");
}

try {
  await pg.start();
  console.log("[db] server started");
} catch (err) {
  console.log(`[db] start attempt: ${err.message}`);
}

const client = new Client({ host: "localhost", port, user, password, database: "postgres" });
await client.connect();
const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
if (rows.length === 0) {
  await client.query(`CREATE DATABASE "${database}"`);
  console.log(`[db] created database "${database}"`);
} else {
  console.log(`[db] database "${database}" already exists`);
}
await client.end();

console.log(`DATABASE_URL=postgres://${user}:${password}@localhost:${port}/${database}`);

process.on("SIGINT", async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);