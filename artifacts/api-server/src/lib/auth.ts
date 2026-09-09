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

function cookieValue(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const token = raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ct_session="))
    ?.slice("ct_session=".length);
  return token ? decodeURIComponent(token) : null;
}

function sessionHash(token: string): string {
  const secret = process.env.SESSION_SECRET ?? "course-tracker-development-secret";
  return createHmac("sha256", secret).update(token).digest("hex");
}

function setSessionCookie(res: Response, token: string): void {
  const maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  res.setHeader(
    "Set-Cookie",
    `ct_session=${encodeURIComponent(token)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    "ct_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  );
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
  setSessionCookie(res, token);
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = cookieValue(req);
  if (token) {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, sessionHash(token)));
  }
  clearSessionCookie(res);
}

export async function resolveAuth(req: Request): Promise<AuthContext | null> {
  const token = cookieValue(req);
  if (!token) return null;
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
  if (!session) return null;

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
          displayName: "Administrator",
          email: null,
          module: null,
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

export async function ensureDefaultAdmin(): Promise<void> {
  const existing = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.username, "admin"))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(adminsTable).values({
    username: "admin",
    passwordHash: await hashPassword("admin123"),
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