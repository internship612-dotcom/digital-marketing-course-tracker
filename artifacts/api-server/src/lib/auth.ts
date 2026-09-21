import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  adminsTable,
  db,
  sessionsTable,
  studentsTable,
  teachersTable,
  type Role,
} from "@workspace/db";

const scrypt = promisify(nodeScrypt);
const SESSION_DAYS = 14;

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://aeywrwzpgyoatwsrtlyd.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXdyd3pwZ3lvYXR3c3J0bHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjgyNDAsImV4cCI6MjEwNDYwNDI0MH0.oSIJYZvksfN-JFo_qha29J-OaQaRBmRMpUMwT7hqoJw";
export const ADMIN_SUPABASE_EMAIL = (
  process.env.SUPABASE_ADMIN_EMAIL ?? "zedkingservice@gmail.com"
).toLowerCase();

export async function resolveSupabaseUserEmail(
  token: string,
): Promise<string | null> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as { email?: string | null };
  return user.email ? normalizeEmail(user.email) : null;
}

export type AuthContext = {
  role: Role;
  userId: string;
  displayName: string;
  email: string | null;
  module: "ai" | "dm" | "sm" | null;
  studentId: string | null;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// One cookie per role, so an admin, a module owner and a student can all be signed in
// in the same browser without overwriting each other's session.
const SESSION_COOKIES: Record<Role, string> = {
  admin: "ct_session_admin",
  teacher: "ct_session_teacher",
  student: "ct_session_student",
};
const LEGACY_SESSION_COOKIE = "ct_session";
const ROLE_ORDER: Role[] = ["admin", "teacher", "student"];

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const value = raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : null;
}

// Which workspace is this request for? Data routes are already role-scoped by path;
// the shared /auth/* routes rely on the x-ct-role hint the SPA sends.
function requestedRole(req: Request): Role | null {
  const header = req.headers["x-ct-role"];
  const hint = Array.isArray(header) ? header[0] : header;
  if (hint === "admin" || hint === "teacher" || hint === "student") return hint;
  const path = req.path.startsWith("/api/") ? req.path.slice(4) : req.path;
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/teacher")) return "teacher";
  if (path.startsWith("/student")) return "student";
  return null;
}

function appendCookie(res: Response, value: string): void {
  const existing = res.getHeader("Set-Cookie");
  const current =
    existing == null
      ? []
      : Array.isArray(existing)
        ? existing.map(String)
        : [String(existing)];
  res.setHeader("Set-Cookie", [...current, value]);
}

// Session tokens are only as private as this secret: anyone holding it can compute
// the hash of a token they invented and hand themselves a live session. The fallback
// below is committed to the repo, so it is a development convenience and nothing more
// — in production the server refuses to start without a real one rather than quietly
// signing sessions with a value the whole world can read.
const DEV_SESSION_SECRET = "course-tracker-development-secret";

function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set to at least 16 characters in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (secret) {
    console.warn(
      "[auth] SESSION_SECRET is shorter than 16 characters; falling back to the development secret.",
    );
  }
  return DEV_SESSION_SECRET;
}

// Resolved once at startup so a misconfigured production deploy fails immediately and
// loudly, not on whichever request happens to need a session first.
const SESSION_SECRET = resolveSessionSecret();

function sessionHash(token: string): string {
  return createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
}

function setSessionCookie(res: Response, role: Role, token: string): void {
  // No Max-Age and no Expires: the browser holds this only until it is closed, so
  // shutting the browser signs every role out. SESSION_DAYS still caps the row itself.
  appendCookie(
    res,
    `${SESSION_COOKIES[role]}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
  );
  // Retire the pre-split cookie so it stops shadowing the role-scoped ones.
  appendCookie(
    res,
    `${LEGACY_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function clearSessionCookie(res: Response, name: string): void {
  appendCookie(res, `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}

export async function createSession(
  res: Response,
  context: AuthContext,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  );
  await db.insert(sessionsTable).values({
    tokenHash: sessionHash(token),
    role: context.role,
    userId: context.userId,
    expiresAt,
  });
  setSessionCookie(res, context.role, token);
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const wanted = requestedRole(req);
  // Signing out of one workspace must leave the other workspaces signed in.
  const roles = wanted ? [wanted] : ROLE_ORDER;
  for (const role of roles) {
    const token = readCookie(req, SESSION_COOKIES[role]);
    if (token) {
      await db
        .delete(sessionsTable)
        .where(eq(sessionsTable.tokenHash, sessionHash(token)));
    }
    clearSessionCookie(res, SESSION_COOKIES[role]);
  }
  const legacy = readCookie(req, LEGACY_SESSION_COOKIE);
  if (legacy) {
    const session = await loadSession(legacy);
    if (session && (!wanted || session.role === wanted)) {
      await db
        .delete(sessionsTable)
        .where(eq(sessionsTable.tokenHash, sessionHash(legacy)));
    }
  }
  clearSessionCookie(res, LEGACY_SESSION_COOKIE);
}

async function loadSession(token: string) {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.tokenHash, sessionHash(token)),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return session ?? null;
}

async function sessionContext(
  session: typeof sessionsTable.$inferSelect,
): Promise<AuthContext | null> {
  if (session.role === "admin") {
    const [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.id, Number(session.userId)))
      .limit(1);
    return admin
      ? {
          role: "admin",
          userId: String(admin.id),
          displayName: admin.displayName,
          email: null,
          module: admin.module,
          studentId: null,
        }
      : null;
  }
  if (session.role === "teacher") {
    const [teacher] = await db
      .select()
      .from(teachersTable)
      .where(eq(teachersTable.id, Number(session.userId)))
      .limit(1);
    return teacher
      ? {
          role: "teacher",
          userId: String(teacher.id),
          displayName: teacher.displayName,
          email: null,
          module: teacher.module,
          studentId: null,
        }
      : null;
  }
  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, session.userId))
    .limit(1);
  return student
    ? {
        role: "student",
        userId: student.id,
        displayName: student.fullName,
        email: student.email,
        module: null,
        studentId: student.id,
      }
    : null;
}

export async function resolveAuth(req: Request): Promise<AuthContext | null> {
  const wanted = requestedRole(req);
  const tokens: string[] = [];
  for (const role of wanted ? [wanted] : ROLE_ORDER) {
    const token = readCookie(req, SESSION_COOKIES[role]);
    if (token) tokens.push(token);
  }
  // Sessions minted before the cookie split still live under the old name; the
  // session row itself is what says which role they are.
  const legacy = readCookie(req, LEGACY_SESSION_COOKIE);
  if (legacy) tokens.push(legacy);

  for (const token of tokens) {
    const session = await loadSession(token);
    if (!session) continue;
    if (wanted && session.role !== wanted) continue;
    const context = await sessionContext(session);
    if (context) return context;
  }
  return null;
}

export async function attachAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  req.auth = (await resolveAuth(req)) ?? undefined;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    next();
  };
}

// Seeds the `admin` row the first time it is needed. POST /auth/login checks this
// row's hash, so whatever goes in here is a live credential — "admin123" was a real
// way into the admin desk for anyone who had read the source.
//
// Production must supply ADMIN_DEFAULT_PASSWORD. If it does not, we seed a random one
// instead of a guessable one and print it once: the operator can read it out of the
// deploy log and change it, and nobody else can guess it in the meantime.
export async function ensureDefaultAdmin(): Promise<void> {
  const existing = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.username, "admin"))
    .limit(1);
  if (existing.length > 0) return;

  const configured = process.env.ADMIN_DEFAULT_PASSWORD;
  let password: string;
  if (configured && configured.length >= 8) {
    password = configured;
  } else if (process.env.NODE_ENV === "production") {
    password = randomBytes(12).toString("base64url");
    console.warn(
      `[auth] ADMIN_DEFAULT_PASSWORD was not set. Seeded the "admin" account with a ` +
        `one-off password: ${password} — sign in and change it now.`,
    );
  } else {
    password = "admin123";
  }

  await db.insert(adminsTable).values({
    username: "admin",
    passwordHash: await hashPassword(password),
    displayName: "AI Admin",
    module: "ai",
  });
}

export function publicUser(context: AuthContext) {
  return {
    role: context.role,
    displayName: context.displayName,
    email: context.email,
    module: context.module,
    studentId: context.studentId,
  };
}

export function nextStudentId(lastId?: string): string {
  const numeric = lastId ? Number(lastId.replace("STU", "")) : 0;
  return `STU${String(numeric + 1).padStart(3, "0")}`;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hashTokenForTests(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}