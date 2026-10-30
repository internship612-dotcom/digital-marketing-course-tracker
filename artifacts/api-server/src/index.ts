import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { runAutoProjectReminders } from "./routes/data";

const rawPort = process.env["PORT"];
const parsedPort = Number(rawPort);
const port =
  rawPort && !Number.isNaN(parsedPort) && parsedPort > 0 ? parsedPort : 5000;

// Hosted deployments get their schema by hand, so a new column or table never reaches the
// database unless this server adds it itself. Run before listening: idempotent on the
// first boot with the new code, a no-op afterwards.
async function ensureAttendanceLeaveColumn(): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS leave_days integer NOT NULL DEFAULT 0",
      ),
    );
  } catch (err) {
    logger.warn({ err }, "Could not ensure attendance.leave_days column");
  }
}

// Institute-wide non-teaching days. Kept separate from the column above because this one is
// a whole table, and it has to be created with its unique constraint on `date` — that is
// what stops two desks recording two different events for the same day.
async function ensureCalendarEventsTable(): Promise<void> {
  try {
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS calendar_events (
          id serial PRIMARY KEY,
          date date NOT NULL UNIQUE,
          title text NOT NULL,
          type text DEFAULT 'event',
          created_by integer REFERENCES teachers(id) ON DELETE SET NULL,
          created_by_admin integer REFERENCES admins(id) ON DELETE SET NULL,
          created_at timestamp with time zone DEFAULT now() NOT NULL
        )
      `),
    );
  } catch (err) {
    logger.warn({ err }, "Could not ensure calendar_events table");
  }
}

async function ensureModuleClassCancellationsTable(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS module_class_cancellations (
        module text NOT NULL,
        date date NOT NULL,
        reason text NOT NULL,
        created_by integer REFERENCES teachers(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (module, date)
      )
    `));
  } catch (err) {
    logger.warn({ err }, "Could not ensure module_class_cancellations table");
  }
}

// Institute = branches → modules. The `module` text columns that used to hold an
// enum now hold free keys; the live DB still has the old enum type, so rewrite it
// to text and (re)seed the branches/modules catalog. Idempotent: every statement
// returns cleanly on a second boot.
async function ensureBranchStructure(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS branches (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS modules (
        id text PRIMARY KEY,
        branch_id integer NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    // Cast the module columns off the old enum type. Each ALTER is guarded on the
    // column actually existing — one missing column must not abort the whole boot
    // migration (and with it the branch/module seed below).
    if (await typeExists("module")) {
      for (const table of ["admins", "teachers", "students", "attendance", "assessments", "announcements", "course_documents"]) {
        if (!(await columnExists(table, "module"))) continue;
        await db.execute(sql.raw(`ALTER TABLE ${table} ALTER COLUMN module DROP DEFAULT, ALTER COLUMN module SET DATA TYPE text USING module::text`));
      }
      await db.execute(sql.raw("DROP TYPE module"));
    }
    // Enum columns were rewritten to text but lost their 'ai'/'dm'/'sm'
    // defaults in the cast; give admins back its old default.
    if (await columnExists("admins", "module")) {
      await db.execute(sql.raw("ALTER TABLE admins ALTER COLUMN module SET DEFAULT 'ai'"));
    }

    await db.execute(sql.raw(`
      ALTER TABLE students ADD COLUMN IF NOT EXISTS branch_id integer REFERENCES branches(id) ON DELETE SET NULL
    `));

    // Branch login: branches gain a username/password pair, and the sessions
    // role enum gains a fourth value. ALTER TYPE ADD VALUE needs PG >= 12.
    try {
      await db.execute(sql.raw("ALTER TYPE role ADD VALUE IF NOT EXISTS 'branch'"));
    } catch {
      logger.warn({}, "Could not extend sessions role enum (already ok?)");
    }
    await db.execute(sql.raw("ALTER TABLE branches ADD COLUMN IF NOT EXISTS username text UNIQUE"));
    await db.execute(sql.raw("ALTER TABLE branches ADD COLUMN IF NOT EXISTS password_hash text"));
    await db.execute(sql.raw("ALTER TABLE branches ADD COLUMN IF NOT EXISTS plain_password text"));

    const zed = await sqlQueryBranchId("Zedking");
    await db.execute(sql.raw(`
      INSERT INTO branches (name, login_code)
      VALUES ('Zedking', 'zedking')
      ON CONFLICT (name) DO NOTHING
    `));
    const zedkingId = zed ?? (await sqlQueryBranchId("Zedking")) ?? 1;

    await db.execute(sql.raw(`
      INSERT INTO modules (id, branch_id, name, login_code)
      VALUES
        ('ai', ${zedkingId}, 'Artificial Intelligence', 'ai'),
        ('dm', ${zedkingId}, 'Digital Marketing', 'dm'),
        ('sm', ${zedkingId}, 'Social Media', 'sm')
      ON CONFLICT (id) DO NOTHING
    `));
    await db.execute(sql.raw(`UPDATE students SET branch_id = ${zedkingId} WHERE branch_id IS NULL`));
  } catch (err) {
    logger.warn({ err }, "Could not ensure branches/modules structure");
  }
}

async function typeExists(typeName: string): Promise<boolean> {
  try {
    const rows = await db.execute(sql.raw(`SELECT 1 FROM pg_type WHERE typname = '${typeName}'`));
    const list = (rows as unknown as { rows: unknown[] }).rows ?? (rows as unknown as unknown[]);
    return list.length > 0;
  } catch {
    return false;
  }
}

async function columnExists(table: string, column: string): Promise<boolean> {
  try {
    const rows = await db.execute(sql.raw(
      `SELECT 1 FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`,
    ));
    const list = (rows as unknown as { rows: unknown[] }).rows ?? (rows as unknown as unknown[]);
    return list.length > 0;
  } catch {
    return false;
  }
}

async function sqlQueryBranchId(name: string): Promise<number | null> {
  try {
    const rows = await db.execute(sql.raw(`SELECT id FROM branches WHERE name = '${name}' LIMIT 1`));
    const first = (rows as unknown as { rows: { id: number }[] }).rows?.[0]
      ?? (rows as unknown as { id: number }[])[0];
    return first?.id ?? null;
  } catch {
    return null;
  }
}

// The notice image column: one image per announcement, base64 data URL. Same pattern as
// attendance.leave_days above — the hosted DB never runs migrations by hand.
async function ensureAnnouncementsImageColumn(): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image text",
      ),
    );
    // Automated project reminders are addressed to one student; module-wide notices leave
    // this null. Added here as well because the hosted database is never migrated by hand.
    await db.execute(
      sql.raw(
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS student_id text REFERENCES students(id) ON DELETE CASCADE",
      ),
    );
  } catch (err) {
    logger.warn({ err }, "Could not ensure announcements.image/student_id columns");
  }
}

// A student's project submission is a name plus a link, kept in its own table rather than
// on `assessments` (see the schema for why). Idempotent: the composite primary key is what
// makes one submission per (student, module, cycle).
async function ensureProjectSubmissionsTable(): Promise<void> {
  try {
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS project_submissions (
          student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          module text NOT NULL,
          cycle integer NOT NULL,
          project_name text NOT NULL,
          project_link text NOT NULL,
          submitted_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (student_id, module, cycle)
        )
      `),
    );
    // An earlier pass put a `project_link` column on `assessments` instead. Nothing reads
    // it any more, and leaving two homes for the same fact is how they drift apart.
    await db.execute(sql.raw("ALTER TABLE assessments DROP COLUMN IF EXISTS project_link"));
  } catch (err) {
    logger.warn({ err }, "Could not ensure project_submissions table");
  }
}

// Shareable login codes. Every branch and module gets a unique `login_code`; the login
// pages open ONLY at /<code> (never at the branch/module name). Two halves, both
// idempotent and both run at boot because the hosted DB is not migrated by hand:
//   1. the columns, backfilled with random codes and made NOT NULL, plus unique indexes;
//   2. `resolve_login_code(code)` — a SECURITY DEFINER function the browser calls through
//      Supabase's PostgREST (supabase.rpc) with only the anon key. It exposes nothing but
//      the type, id, display name and (for a module) its branch name, so neither table has
//      to become publicly readable. The API also resolves codes directly, as a fallback.
const LOGIN_CODE_RESERVED = new Set([
  "admin", "student", "teacher", "branch", "login", "logout", "signup", "signin",
  "register", "api", "assets", "static", "dashboard", "module", "modules", "settings",
  "documents", "announcements", "students", "panel-logins", "branches", "project",
  "profile", "attendance", "assessment", "reports", "report", "home", "catalog", "healthz",
]);

const LOGIN_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newLoginCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += LOGIN_CODE_ALPHABET[randomInt(LOGIN_CODE_ALPHABET.length)];
  return out;
}

function uniqueLoginCode(used: Set<string>): string {
  for (;;) {
    const code = newLoginCode();
    if (used.has(code) || LOGIN_CODE_RESERVED.has(code)) continue;
    used.add(code);
    return code;
  }
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (
    (result as { rows?: Record<string, unknown>[] }).rows ??
    (Array.isArray(result) ? (result as Record<string, unknown>[]) : [])
  );
}

async function backfillLoginCodes(table: string, used: Set<string>): Promise<void> {
  const res = await db.execute(sql.raw(`SELECT id FROM ${table} WHERE login_code IS NULL`));
  for (const row of rowsOf(res)) {
    const code = uniqueLoginCode(used);
    const id = row.id as string | number;
    const literal = typeof id === "number" ? id : `'${String(id).replace(/'/g, "''")}'`;
    await db.execute(sql.raw(`UPDATE ${table} SET login_code = '${code}' WHERE id = ${literal}`));
  }
}

async function ensureLoginCodes(): Promise<void> {
  try {
    await db.execute(sql.raw("ALTER TABLE branches ADD COLUMN IF NOT EXISTS login_code text"));
    await db.execute(sql.raw("ALTER TABLE modules ADD COLUMN IF NOT EXISTS login_code text"));
    await db.execute(sql.raw("ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_logo text"));
    if (await columnExists("branches", "logo_path")) {
      await db.execute(sql.raw("UPDATE branches SET branch_logo = logo_path WHERE branch_logo IS NULL AND logo_path IS NOT NULL"));
    }

    const used = new Set<string>();
    const existing = await db.execute(
      sql.raw(
        "SELECT login_code FROM branches WHERE login_code IS NOT NULL UNION ALL SELECT login_code FROM modules WHERE login_code IS NOT NULL",
      ),
    );
    for (const row of rowsOf(existing)) {
      if (typeof row.login_code === "string") used.add(row.login_code);
    }
    await backfillLoginCodes("branches", used);
    await backfillLoginCodes("modules", used);

    await db.execute(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS branches_login_code_key ON branches (login_code)"));
    await db.execute(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS modules_login_code_key ON modules (login_code)"));
    await db.execute(sql.raw("ALTER TABLE branches ALTER COLUMN login_code SET NOT NULL"));
    await db.execute(sql.raw("ALTER TABLE modules ALTER COLUMN login_code SET NOT NULL"));

    // CREATE OR REPLACE cannot change a function's return type, and this function's
    // signature gained logo_url, so drop the old one first or the replace silently fails.
    await db.execute(sql.raw("DROP FUNCTION IF EXISTS resolve_login_code(text)"));
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION resolve_login_code(code text)
      RETURNS TABLE(type text, id text, name text, branch_name text, logo_url text)
      LANGUAGE sql
      SECURITY DEFINER
      STABLE
      SET search_path = public
      AS $fn$
           SELECT 'branch'::text AS type, b.id::text AS id, b.name AS name, NULL::text AS branch_name,
            CASE WHEN b.branch_logo LIKE 'data:image/%' THEN b.branch_logo
              WHEN b.branch_logo IS NOT NULL
                THEN 'https://aeywrwzpgyoatwsrtlyd.supabase.co/storage/v1/object/public/branch-logos/' || b.branch_logo
                    ELSE NULL END AS logo_url
        FROM branches b
        WHERE b.login_code = lower(trim(code))
        UNION ALL
        SELECT 'module'::text AS type, m.id::text AS id, m.name AS name, br.name AS branch_name,
               NULL::text AS logo_url
        FROM modules m
        JOIN branches br ON br.id = m.branch_id
        WHERE m.login_code = lower(trim(code))
        LIMIT 1
      $fn$
    `));
    // Postgres functions are executable by PUBLIC by default; tighten that and hand the
    // right to the two PostgREST roles only. The roles exist in Supabase, not in the local
    // embedded database, so the grants are guarded.
    await db.execute(sql.raw("REVOKE ALL ON FUNCTION resolve_login_code(text) FROM PUBLIC"));
    await db.execute(sql.raw(`
      DO $grant$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          GRANT EXECUTE ON FUNCTION resolve_login_code(text) TO anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          GRANT EXECUTE ON FUNCTION resolve_login_code(text) TO authenticated;
        END IF;
      END
      $grant$
    `));
  } catch (err) {
    logger.warn({ err }, "Could not ensure login codes / resolve_login_code");
  }
}

ensureCalendarEventsTable()
  .then(ensureModuleClassCancellationsTable)
  .then(ensureAttendanceLeaveColumn)
  .then(ensureAnnouncementsImageColumn)
  .then(ensureProjectSubmissionsTable)
  .then(ensureBranchStructure)
  .then(ensureLoginCodes)
  .catch((err) => logger.warn({ err }, "Schema checks failed"))
  .finally(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");

      // Project reminders are every fifteen days per student, so an hourly pass is plenty;
      // the run itself is idempotent, which is why a restart can safely re-check immediately.
      const runReminders = () => {
        void runAutoProjectReminders()
          .then((result) => logger.info(result, "Project reminders checked"))
          .catch((error) => logger.warn({ err: error }, "Project reminder pass failed"));
      };
      runReminders();
      setInterval(runReminders, 60 * 60 * 1000).unref();
    });
  });
