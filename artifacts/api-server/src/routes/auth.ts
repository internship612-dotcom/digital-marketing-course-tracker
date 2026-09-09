import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  adminsTable,
  studentsTable,
  teachersTable,
} from "@workspace/db";
import {
  LoginBody,
  RegisterStudentBody,
  GetCurrentUserResponse,
  LoginResponse,
  RegisterStudentResponse,
  UpdateAdminPasswordBody,
} from "@workspace/api-zod";
import {
  createSession,
  destroySession,
  ensureDefaultAdmin,
  hashPassword,
  nextStudentId,
  normalizeEmail,
  publicUser,
  requireRole,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.auth) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(publicUser(req.auth)));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid role, identifier, and password." });
    return;
  }
  await ensureDefaultAdmin();
  const { role, identifier, password } = parsed.data;
  let context:
    | {
        role: "admin" | "teacher" | "student";
        userId: string;
        displayName: string;
        email: string | null;
        module: "ai" | "dm" | "sm" | null;
        studentId: string | null;
        passwordHash: string;
      }
    | undefined;

  if (role === "admin") {
    const [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.username, identifier.trim()))
      .limit(1);
    if (admin) {
      context = {
        role,
        userId: String(admin.id),
        displayName: "Administrator",
        email: null,
        module: null,
        studentId: null,
        passwordHash: admin.passwordHash,
      };
    }
  } else if (role === "teacher") {
    const [teacher] = await db
      .select()
      .from(teachersTable)
      .where(eq(teachersTable.username, identifier.trim()))
      .limit(1);
    if (teacher) {
      context = {
        role,
        userId: String(teacher.id),
        displayName: teacher.displayName,
        email: null,
        module: teacher.module,
        studentId: null,
        passwordHash: teacher.passwordHash,
      };
    }
  } else {
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.email, normalizeEmail(identifier)))
      .limit(1);
    if (student) {
      context = {
        role,
        userId: student.id,
        displayName: student.fullName,
        email: student.email,
        module: null,
        studentId: student.id,
        passwordHash: student.passwordHash,
      };
    }
  }

  if (!context || !(await verifyPassword(password, context.passwordHash))) {
    res.status(400).json({ error: "The credentials do not match our records." });
    return;
  }

  const { passwordHash: _passwordHash, ...safeContext } = context;
  await createSession(res, safeContext);
  res.json(LoginResponse.parse(publicUser(safeContext)));
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please complete all registration fields correctly." });
    return;
  }
  const data = parsed.data;
  if (data.password !== data.confirmPassword) {
    res.status(400).json({ error: "Passwords do not match." });
    return;
  }
  const email = normalizeEmail(data.email);
  const [existing] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(eq(studentsTable.email, email))
    .limit(1);
  if (existing) {
    res.status(400).json({ error: "An account with this email already exists." });
    return;
  }
  const [lastStudent] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .orderBy(desc(studentsTable.registrationDate))
    .limit(1);
  const id = nextStudentId(lastStudent?.id);
  const [student] = await db
    .insert(studentsTable)
    .values({
      id,
      fullName: data.fullName.trim(),
      fathersName: data.fathersName.trim(),
      course: data.course.trim(),
      dateOfJoining: data.dateOfJoining.toISOString().slice(0, 10),
      contactNumber: data.contactNumber.trim(),
      email,
      passwordHash: await hashPassword(data.password),
    })
    .returning();
  const context = {
    role: "student" as const,
    userId: student.id,
    displayName: student.fullName,
    email: student.email,
    module: null,
    studentId: student.id,
  };
  await createSession(res, context);
  res.status(201).json(RegisterStudentResponse.parse(publicUser(context)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroySession(req, res);
  res.sendStatus(204);
});

router.patch(
  "/admin/account/password",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateAdminPasswordBody.safeParse(req.body);
    if (!parsed.success || !req.auth) {
      res.status(400).json({ error: "Enter a valid new password." });
      return;
    }
    const [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.id, Number(req.auth.userId)))
      .limit(1);
    if (!admin || !(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
      res.status(400).json({ error: "The current password is incorrect." });
      return;
    }
    await db
      .update(adminsTable)
      .set({ passwordHash: await hashPassword(parsed.data.newPassword) })
      .where(eq(adminsTable.id, admin.id));
    res.sendStatus(204);
  },
);

export default router;