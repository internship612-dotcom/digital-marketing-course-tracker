import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// The local embedded Postgres is started without TLS, while every hosted provider
// (Supabase included) refuses a plaintext connection. Decide from the host rather than
// from NODE_ENV, so pointing a local dev run at the hosted database also works.
function needsSsl(url: string): boolean {
  if (/[?&]sslmode=disable/.test(url)) return false;
  try {
    const host = new URL(url).hostname;
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}

const connectionString = process.env.DATABASE_URL;

// node-postgres does not percent-decode the credentials inside a connection string, so
// a password containing "@" — which the URL form *requires* be written as %40 — arrives
// with the escape intact and authentication fails. Hosted providers hand out exactly
// such strings (Supabase shows the password pre-encoded), so parse the URL here and
// pass the decoded parts as fields instead of trusting the driver with the whole string.
function poolConfigFrom(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { connectionString: url };
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return { connectionString: url };

  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    // Leading slash off; an empty path means the driver's own default.
    database: parsed.pathname.slice(1)
      ? decodeURIComponent(parsed.pathname.slice(1))
      : undefined,
  };
}

export const pool = new Pool({
  ...poolConfigFrom(connectionString),
  // Supabase terminates TLS at a pooler whose certificate does not match the host name
  // it is reached on, so verification is switched off. The connection is still
  // encrypted; this only skips checking who is on the other end.
  ...(needsSsl(connectionString) ? { ssl: { rejectUnauthorized: false } } : {}),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
