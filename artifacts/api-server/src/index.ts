import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];
const parsedPort = Number(rawPort);
const port =
  rawPort && !Number.isNaN(parsedPort) && parsedPort > 0 ? parsedPort : 5000;

// Hosted deployments get their schema by hand, so a new column never reaches the
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

ensureAttendanceLeaveColumn().finally(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});
