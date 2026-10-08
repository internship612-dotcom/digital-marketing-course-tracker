import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";

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
      INSERT INTO branches (name)
      VALUES ('Zedking')
      ON CONFLICT (name) DO NOTHING
    `));
    const zedkingId = zed ?? (await sqlQueryBranchId("Zedking")) ?? 1;

    await db.execute(sql.raw(`
      INSERT INTO modules (id, branch_id, name)
      VALUES
        ('ai', ${zedkingId}, 'Artificial Intelligence'),
        ('dm', ${zedkingId}, 'Digital Marketing'),
        ('sm', ${zedkingId}, 'Social Media')
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
  } catch (err) {
    logger.warn({ err }, "Could not ensure announcements.image column");
  }
}

ensureCalendarEventsTable()
  .then(ensureAttendanceLeaveColumn)
  .then(ensureAnnouncementsImageColumn)
  .then(ensureBranchStructure)
  .catch((err) => logger.warn({ err }, "Schema checks failed"))
  .finally(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  });
