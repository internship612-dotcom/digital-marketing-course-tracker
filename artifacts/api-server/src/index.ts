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
