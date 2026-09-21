import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachAuth } from "./lib/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
// Profile photos travel as data URLs, well past the 100kb default.
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(attachAuth);

app.use("/api", router);

// In development Vite serves the client on its own port and proxies /api here. Nothing
// does that in a deployment: the built bundle runs alone, so without the block below the
// API answers /api/* and every other URL 404s — the site itself never appears.
//
// Resolves the same from src/ and from dist/, since both sit one level inside the
// package: ../../course-tracker/dist/public either way.
const clientDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../course-tracker/dist/public",
);

if (fs.existsSync(path.join(clientDir, "index.html"))) {
  // index: false so "/" falls through to the SPA handler below and takes the same path
  // as every other route, rather than being special-cased by the static middleware.
  app.use(express.static(clientDir, { index: false }));

  // Wouter owns the routing, so a deep link such as /admin/documents has to come back as
  // index.html. A plain middleware rather than app.get("*"): Express 5 rewrote wildcard
  // patterns, and this also lets an unmatched /api/* keep falling through to a JSON 404
  // instead of quietly returning HTML to a fetch().
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDir, "index.html"));
  });

  logger.info({ clientDir }, "Serving client build");
} else {
  logger.warn(
    { clientDir },
    "Client build not found — serving /api only. Run the course-tracker build before deploying.",
  );
}

export default app;
