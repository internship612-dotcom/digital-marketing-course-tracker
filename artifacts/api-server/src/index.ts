import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];
const parsedPort = Number(rawPort);
const port =
  rawPort && !Number.isNaN(parsedPort) && parsedPort > 0 ? parsedPort : 5000;

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
