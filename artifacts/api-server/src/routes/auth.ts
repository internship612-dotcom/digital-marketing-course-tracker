import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  adminsTable,
  branchesTable,
  studentsTable,
  teachersTable,
} from "@workspace/db";
import {
  RegisterAdminBody,
  RegisterAdminResponse,
  LoginBody,
  RegisterStudentBody,
  GetCurrentUserResponse,
  LoginResponse,
  RegisterStudentResponse,
  UpdateAdminPasswordBody,
  LoginSupabaseAdminBody,
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
  resolveSupabaseUserEmail,
  verifyPassword,
  ADMIN_SUPABASE_EMAIL,
  supabasePasswordGrant,
  supabaseUpdatePassword,
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
        role: "admin" | "teacher" | "student" | "branch";
        userId: string;
        displayName: string;
        email: string | null;
        module: string | null;
        studentId: string | null;
        branchId: number | null;
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
        branchId: null,
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
        role: "teacher",
        userId: String(teacher.id),
        displayName: teacher.displayName,
        email: null,
        module: teacher.module,
        studentId: null,
        branchId: null,
        passwordHash: teacher.passwordHash,
      };
    }
  } else if (role === "branch") {
    const [branch] = await db
      .select()
      .from(branchesTable)
      .where(eq(branchesTable.username, identifier.trim()))
      .limit(1);
    if (branch && branch.passwordHash) {
      context = {
        role: "branch",
        userId: String(branch.id),
        displayName: branch.name,
        email: null,
        module: null,
        studentId: null,
        branchId: branch.id,
        passwordHash: branch.passwordHash,
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
        role: "student",
        userId: student.id,
        displayName: student.fullName,
        email: student.email,
        module: null,
        studentId: student.id,
        branchId: null,
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
  const branchId = data.branchId ?? null;
  if (branchId != null) {
    const [branch] = await db
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(eq(branchesTable.id, branchId))
      .limit(1);
    if (!branch) {
      res.status(400).json({ error: "Selected branch not found." });
      return;
    }
  }
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
      branchId,
    })
    .returning();
  const context = {
    role: "student" as const,
    userId: student.id,
    displayName: student.fullName,
    email: student.email,
    module: null,
    studentId: student.id,
    branchId: student.branchId ?? null,
  };
  await createSession(res, context);
  res.status(201).json(RegisterStudentResponse.parse(publicUser(context)));
});

router.post("/auth/register-admin", async (req, res): Promise<void> => {
  // Open self-registration of an admin row is a takeover vector in production:
  // anyone could mint a full admin session, and local login then honours it. In
  // production an existing signed-in admin must be the one creating the row.
  // Dev/test keeps the endpoint open because that is where the first admin
  // account gets created.
  if (process.env.NODE_ENV === "production" && req.auth?.role !== "admin") {
    res.status(403).json({ error: "Admin accounts can only be created by a signed-in admin." });
    return;
  }
  const parsed = RegisterAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please complete all admin registration fields correctly." });
    return;
  }
  const data = parsed.data;
  if (data.password !== data.confirmPassword) {
    res.status(400).json({ error: "Passwords do not match." });
    return;
  }
  const [existingUsername] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.username, data.username.trim()))
    .limit(1);
  if (existingUsername) {
    res.status(400).json({ error: "That admin username is already in use." });
    return;
  }
  const [existingModule] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.module, data.module))
    .limit(1);
  if (existingModule) {
    res.status(400).json({ error: "That designation already has an admin account." });
    return;
  }
  const [admin] = await db
    .insert(adminsTable)
    .values({
      username: data.username.trim(),
      displayName: data.displayName.trim(),
      module: data.module,
      passwordHash: await hashPassword(data.password),
    })
    .returning();
  const context = {
    role: "admin" as const,
    userId: String(admin.id),
    displayName: admin.displayName,
    email: null,
    module: admin.module,
    studentId: null,
    branchId: null,
  };
  await createSession(res, context);
  res.status(201).json(RegisterAdminResponse.parse(publicUser(context)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroySession(req, res);
  res.sendStatus(204);
});

router.post("/auth/admin/supabase", async (req, res): Promise<void> => {
  const parsed = LoginSupabaseAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid admin session token." });
    return;
  }
  await ensureDefaultAdmin();
  const email = await resolveSupabaseUserEmail(parsed.data.token);
  if (!email || email !== ADMIN_SUPABASE_EMAIL) {
    res.status(401).json({ error: "This account is not an administrator." });
    return;
  }
  let [admin] = await db
    .select()
    .from(adminsTable)
    .where(eq(adminsTable.username, email))
    .limit(1);
  if (!admin) {
    [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.username, "admin"))
      .limit(1);
  }
  if (!admin) {
    res.status(500).json({ error: "No admin account is configured." });
    return;
  }
  const context = {
    role: "admin" as const,
    userId: String(admin.id),
    displayName: "Administrator",
    email: null,
    module: admin.module,
    studentId: null,
    branchId: null,
  };
  await createSession(res, context);
  res.json(LoginResponse.parse(publicUser(context)));
});

// Local proxy for admin sign-in. The browser sends the email/password, this server
// checks Supabase itself and, on success, issues a normal session cookie — so no
// Supabase URL or key ever shows up in the browser's network tab.
router.post("/auth/admin/local", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const grant = email && password ? await supabasePasswordGrant(email, password) : null;
  if (!grant || email !== ADMIN_SUPABASE_EMAIL) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }
  await ensureDefaultAdmin();
  let [admin] = await db
    .select()
    .from(adminsTable)
    .where(eq(adminsTable.username, email))
    .limit(1);
  if (!admin) {
    [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.username, "admin"))
      .limit(1);
  }
  if (!admin) {
    res.status(500).json({ error: "No admin account is configured." });
    return;
  }
  const context = {
    role: "admin" as const,
    userId: String(admin.id),
    displayName: "Administrator",
    email,
    module: admin.module,
    studentId: null,
    branchId: null,
  };
  await createSession(res, context);
  res.json(LoginResponse.parse(publicUser(context)));
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
    if (!admin) {
      res.status(404).json({ error: "Admin account not found." });
      return;
    }
    // Verify via Supabase first — that is what the user actually signs in with. Fall
    // back to the local hash only when Supabase is unreachable.
    const email = req.auth.email ?? ADMIN_SUPABASE_EMAIL;
    const grant = await supabasePasswordGrant(email, parsed.data.currentPassword);
    if (!grant) {
      if (!(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
        res.status(400).json({ error: "The current password is incorrect." });
        return;
      }
      // Supabase unreachable but the local password still matches: let the change
      // through locally, and the admins hash below stays the single source.
    } else {
      const updated = await supabaseUpdatePassword(grant.accessToken, parsed.data.newPassword);
      if (!updated) {
        res.status(502).json({ error: "We could not reach the identity service to update that password." });
        return;
      }
    }
    await db
      .update(adminsTable)
      .set({ passwordHash: await hashPassword(parsed.data.newPassword) })
      .where(eq(adminsTable.id, admin.id));
    res.sendStatus(204);
  },
);

router.post(
  "/admin/account/verify-password",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      res.status(400).json({ error: "Enter your password to continue." });
      return;
    }
    // Admin credential lives in Supabase; verify via a sign-in grant. Falls back to
    // the local stored hash only when Supabase is unreachable.
    const email = req.auth.email ?? ADMIN_SUPABASE_EMAIL;
    if (await supabasePasswordGrant(email, password)) {
      res.sendStatus(204);
      return;
    }
    const [admin] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.id, Number(req.auth.userId)))
      .limit(1);
    if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
      res.status(400).json({ error: "The password is incorrect." });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;