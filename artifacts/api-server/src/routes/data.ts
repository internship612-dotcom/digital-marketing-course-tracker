import { Router, type IRouter } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  announcementsTable,
  assessmentsTable,
  attendanceTable,
  branchesTable,
  calendarEventsTable,
  courseDocumentsTable,
  db,
  modulesCatalog,
  sessionsTable,
  studentsTable,
  teachersTable,
} from "@workspace/db";
import {
  AdminSummary,
  AttendanceBulkInput,
  AttendanceReport,
  AssessmentBulkInput,
  AssessmentReport,
  CreateTeacherBody,
  CreateTeacherResponse,
  DeleteTeacherParams,
  GetAdminSummaryResponse,
  GetStudentAssessmentReportResponse,
  GetStudentAttendanceReportResponse,
  GetTeacherAssessmentsQueryParams,
  GetTeacherAssessmentsResponse,
  GetTeacherAttendanceQueryParams,
  GetTeacherAttendanceResponse,
  ListAllAssessmentsResponse,
  ListAllAttendanceResponse,
  ListStudentsQueryParams,
  ListStudentsResponse,
  ListTeachersResponse,
  ListTeacherStudentsQueryParams,
  ListTeacherStudentsResponse,
  CreateStudentBody,
  CreateStudentResponse,
  GetStudentParams,
  GetStudentResponse,
  UpdateStudentBody,
  UpdateStudentPasswordBody,
  UpdateStudentPasswordParams,
  SaveTeacherAssessmentsBody,
  SaveTeacherAssessmentsResponse,
  SaveTeacherAttendanceBody,
  SaveTeacherAttendanceResponse,
  UpdateTeacherBody,
  UpdateTeacherParams,
  UpdateTeacherResponse,
} from "@workspace/api-zod";
import {
  hashPassword,
  nextStudentId,
  normalizeEmail,
  requireRole,
} from "../lib/auth";

const router: IRouter = Router();
const DEFAULT_WEEKS = 12;
const DEFAULT_CYCLES = 6;
// A module is an admin-defined row in the modules catalog, scoped by branch. Historical
// student/teacher/attendance rows still carry the old 'ai'/'dm'/'sm' text keys — those were
// the seed rows inserted at migration time, so "text key" and "module" are the same thing.
type Module = string;

// Source of truth for the module id set at request time: the catalog, not a hardcoded list.
async function validModuleIds(): Promise<string[]> {
  try {
    const rows = await db.select({ id: modulesCatalog.id }).from(modulesCatalog);
    return rows.map((row) => row.id);
  } catch {
    return ["ai", "dm", "sm"];
  }
}

async function isValidModule(id: string): Promise<boolean> {
  return (await validModuleIds()).includes(id);
}

// Modules a given student can see: only those inside their own branch. Students that
// predate the branch column read as the seed Zedking branch (migration backfilled it),
// so "null branchId" is treated as Zedking.
async function studentModuleKeys(studentId: string): Promise<string[]> {
  const [row] = await db
    .select({ branchId: studentsTable.branchId })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId))
    .limit(1);
  const branchId = row?.branchId ?? null;
  if (branchId == null) {
    const rows = await db
      .select({ id: modulesCatalog.id })
      .from(modulesCatalog)
      .innerJoin(branchesTable, eq(modulesCatalog.branchId, branchesTable.id))
      .where(eq(branchesTable.name, "Zedking"));
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: modulesCatalog.id })
    .from(modulesCatalog)
    .where(eq(modulesCatalog.branchId, branchId));
  return rows.map((r) => r.id);
}

async function branchModuleIds(branchId: number): Promise<string[]> {
  const rows = await db
    .select({ id: modulesCatalog.id })
    .from(modulesCatalog)
    .where(eq(modulesCatalog.branchId, branchId));
  return rows.map((r) => r.id);
}

function moduleLabel(module: Module): string {
  return module === "ai"
    ? "AI"
    : module === "dm"
      ? "Digital Marketing"
      : "Social Media";
}

function studentView(student: typeof studentsTable.$inferSelect) {
  return {
    id: student.id,
    fullName: student.fullName,
    fathersName: student.fathersName,
    course: student.course,
    dateOfJoining: student.dateOfJoining,
    contactNumber: student.contactNumber,
    email: student.email,
    registrationDate: student.registrationDate.toISOString(),
    branchId: student.branchId ?? null,
    photo: student.photo,
    remark: student.remark,
    address: student.address,
    guardianContact: student.guardianContact,
  };
}

// Optional free text: an empty box is stored as nothing rather than "".
function optionalText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

function attendanceView(
  record: typeof attendanceTable.$inferSelect,
  studentName?: string,
  teacherName?: string | null,
) {
  return {
    studentId: record.studentId,
    studentName: studentName ?? "",
    module: record.module,
    week: record.week,
    status: record.status,
    recordedBy: teacherName ?? null,
  };
}

function dayView(record: typeof attendanceTable.$inferSelect) {
  return {
    studentId: record.studentId,
    week: record.week,
    status: record.status,
    mon: record.mon,
    tue: record.tue,
    wed: record.wed,
    thu: record.thu,
    fri: record.fri,
    sat: record.sat,
  };
}

function assessmentView(
  record: typeof assessmentsTable.$inferSelect,
  studentName?: string,
) {
  return {
    studentId: record.studentId,
    studentName: studentName ?? "",
    module: record.module,
    cycle: record.cycle,
    marks: record.marks,
    feedback: record.feedback,
    projectName: record.projectName,
    enteredAt: record.enteredAt?.toISOString() ?? null,
  };
}

router.get(
  "/admin/summary",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const [students] = await db.select({ value: count() }).from(studentsTable);
    const [teachers] = await db.select({ value: count() }).from(teachersTable);
    const [attendance] = await db
      .select({ value: count() })
      .from(attendanceTable);
    const [assessments] = await db
      .select({ value: count() })
      .from(assessmentsTable);
    const grouped = await db
      .select({ module: studentsTable.course, value: count() })
      .from(studentsTable)
      .groupBy(studentsTable.course);
    const summary = {
      studentCount: Number(students.value),
      teacherCount: Number(teachers.value),
      attendanceCount: Number(attendance.value),
      assessmentCount: Number(assessments.value),
      moduleCounts: Object.fromEntries(
        grouped.map((row) => [row.module, Number(row.value)]),
      ),
    };
    res.json(GetAdminSummaryResponse.parse(summary));
  },
);

router.get(
  "/admin/teachers",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const teachers = await db
      .select()
      .from(teachersTable)
      .orderBy(asc(teachersTable.displayName));
    res.json(
      ListTeachersResponse.parse(
        teachers.map((teacher) => ({
          id: teacher.id,
          username: teacher.username,
          module: teacher.module,
          displayName: teacher.displayName,
          plainPassword: teacher.plainPassword ?? null,
        })),
      ),
    );
  },
);

router.post(
  "/admin/teachers",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateTeacherBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter valid teacher details." });
      return;
    }
    const username = parsed.data.username.trim();

    // A module may hold several logins, so only the username has to be free.
    // A create never touches the module's existing logins.
    const [usernameTaken] = await db
      .select({ id: teachersTable.id })
      .from(teachersTable)
      .where(eq(teachersTable.username, username))
      .limit(1);
    if (usernameTaken) {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }

    try {
      const [teacher] = await db
        .insert(teachersTable)
        .values({
          username,
          passwordHash: await hashPassword(parsed.data.password),
          module: parsed.data.module,
          displayName: parsed.data.displayName.trim(),
          plainPassword: parsed.data.password,
        })
        .returning();
      res
        .status(201)
        .json(
          CreateTeacherResponse.parse({
            id: teacher.id,
            username: teacher.username,
            module: teacher.module,
            displayName: teacher.displayName,
            plainPassword: teacher.plainPassword ?? null,
          }),
        );
    } catch {
      res.status(400).json({ error: "Could not create this login." });
    }
  },
);

router.patch(
  "/admin/teachers/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = UpdateTeacherParams.safeParse(req.params);
    const body = UpdateTeacherBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Enter valid teacher details." });
      return;
    }
    const values: Partial<typeof teachersTable.$inferInsert> = {};
    if (body.data.username !== undefined) values.username = body.data.username.trim();
    if (body.data.displayName !== undefined) {
      values.displayName = body.data.displayName.trim();
    }
    if (body.data.module !== undefined) values.module = body.data.module;
    if (body.data.password !== undefined) {
      values.passwordHash = await hashPassword(body.data.password);
      values.plainPassword = body.data.password;
    }

    // Editing a login must never take over another owner's username.
    if (values.username !== undefined) {
      const [usernameTaken] = await db
        .select({ id: teachersTable.id })
        .from(teachersTable)
        .where(
          and(
            eq(teachersTable.username, values.username),
            ne(teachersTable.id, params.data.id),
          ),
        )
        .limit(1);
      if (usernameTaken) {
        res.status(409).json({ error: "That username is already in use." });
        return;
      }
    }

    try {
      const [teacher] = await db
        .update(teachersTable)
        .set(values)
        .where(eq(teachersTable.id, params.data.id))
        .returning();
      if (!teacher) {
        res.status(404).json({ error: "Teacher not found." });
        return;
      }
      res.json(
        UpdateTeacherResponse.parse({
          id: teacher.id,
          username: teacher.username,
          module: teacher.module,
          displayName: teacher.displayName,
          plainPassword: teacher.plainPassword ?? null,
        }),
      );
    } catch {
      res.status(400).json({ error: "Could not save this login." });
    }
  },
);

router.delete(
  "/admin/teachers/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = DeleteTeacherParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid teacher." });
      return;
    }
    const deleted = await db
      .delete(teachersTable)
      .where(eq(teachersTable.id, params.data.id))
      .returning({ id: teachersTable.id });
    if (!deleted[0]) {
      res.status(404).json({ error: "Teacher not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/admin/students",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = ListStudentsQueryParams.safeParse(req.query);
    const search = parsed.success ? parsed.data.search?.trim() : undefined;
    const students = await db
      .select()
      .from(studentsTable)
      .where(
        search
          ? or(
              ilike(studentsTable.fullName, `%${search}%`),
              ilike(studentsTable.email, `%${search}%`),
              ilike(studentsTable.id, `%${search}%`),
            )
          : undefined,
      )
      .orderBy(asc(studentsTable.fullName));
    res.json(ListStudentsResponse.parse(students.map(studentView)));
  },
);

router.post(
  "/admin/students",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateStudentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please complete all student fields correctly." });
      return;
    }
    const data = parsed.data;
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
        id: nextStudentId(lastStudent?.id),
        fullName: data.fullName.trim(),
        fathersName: data.fathersName.trim(),
        course: data.course.trim(),
        dateOfJoining: data.dateOfJoining.toISOString().slice(0, 10),
        contactNumber: data.contactNumber.trim(),
        email,
        address: optionalText(data.address),
        guardianContact: optionalText(data.guardianContact),
        passwordHash: await hashPassword(data.password),
        plainPassword: data.password,
        branchId,
      })
      .returning();
    res.status(201).json(CreateStudentResponse.parse(studentView(student)));
  },
);

// The student list on both portals shows one attendance icon and one marks icon per
// student, so each portal needs a cheap "who has anything recorded" lookup. The
// teacher version is module-scoped (/teacher/overview/students); this admin version
// counts a student as covered when ANY module has touched them.
// Registered ahead of /admin/students/:id so "status" is not read as a student id.
router.get(
  "/admin/students/status",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    res.json(await buildStatus(await validModuleIds()));
  },
);

router.get(
  "/admin/students/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = GetStudentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid student." });
      return;
    }
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, params.data.id))
      .limit(1);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(GetStudentResponse.parse(studentView(student)));
  },
);

router.delete(
  "/admin/students/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = GetStudentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid student." });
      return;
    }
    const deleted = await db
      .delete(studentsTable)
      .where(eq(studentsTable.id, params.data.id))
      .returning({ id: studentsTable.id });
    if (!deleted[0]) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    await db
      .delete(sessionsTable)
      .where(
        and(eq(sessionsTable.userId, params.data.id), eq(sessionsTable.role, "student")),
      );
    res.sendStatus(204);
  },
);

router.patch(
  "/admin/students/:id/password",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = UpdateStudentPasswordParams.safeParse(req.params);
    const body = UpdateStudentPasswordBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Enter a valid new password." });
      return;
    }
    const updated = await db
      .update(studentsTable)
      .set({
        passwordHash: await hashPassword(body.data.password),
        plainPassword: body.data.password,
      })
      .where(eq(studentsTable.id, params.data.id))
      .returning({ id: studentsTable.id });
    if (!updated[0]) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/admin/attendance",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        record: attendanceTable,
        studentName: studentsTable.fullName,
        teacherName: teachersTable.displayName,
      })
      .from(attendanceTable)
      .innerJoin(studentsTable, eq(attendanceTable.studentId, studentsTable.id))
      .leftJoin(teachersTable, eq(attendanceTable.recordedBy, teachersTable.id))
      .orderBy(desc(attendanceTable.week), asc(studentsTable.fullName));
    res.json(
      ListAllAttendanceResponse.parse(
        rows.map((row) =>
          attendanceView(row.record, row.studentName, row.teacherName),
        ),
      ),
    );
  },
);

router.get(
  "/admin/assessments",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        record: assessmentsTable,
        studentName: studentsTable.fullName,
      })
      .from(assessmentsTable)
      .innerJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
      .orderBy(desc(assessmentsTable.cycle), asc(studentsTable.fullName));
    res.json(
      ListAllAssessmentsResponse.parse(
        rows.map((row) => assessmentView(row.record, row.studentName)),
      ),
    );
  },
);

router.get(
  "/teacher/students",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = ListTeacherStudentsQueryParams.safeParse(req.query);
    const search = parsed.success ? parsed.data.search?.trim() : undefined;
    const students = await db
      .select()
      .from(studentsTable)
      .where(
        search
          ? or(
              ilike(studentsTable.fullName, `%${search}%`),
              ilike(studentsTable.email, `%${search}%`),
              ilike(studentsTable.id, `%${search}%`),
            )
          : undefined,
      )
      .orderBy(asc(studentsTable.fullName));
    res.json(ListTeacherStudentsResponse.parse(students.map(studentView)));
  },
);

// Module owners enrol students from their own desk. Students are global (no module
// column), so this mirrors POST /admin/students exactly — same validation, same ids —
// except the branch: the owner's module decides it, never the request body, because a
// module desk has no branch picker and its students always belong to that module's branch.
router.post(
  "/teacher/students",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = CreateStudentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please complete all student fields correctly." });
      return;
    }
    const data = parsed.data;
    if (!req.auth?.module) {
      res.status(400).json({ error: "Module not resolved." });
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
    const [ownerModule] = await db
      .select({ branchId: modulesCatalog.branchId })
      .from(modulesCatalog)
      .where(eq(modulesCatalog.id, req.auth.module))
      .limit(1);
    const branchId = ownerModule?.branchId ?? data.branchId ?? null;
    const [lastStudent] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .orderBy(desc(studentsTable.registrationDate))
      .limit(1);
    const [student] = await db
      .insert(studentsTable)
      .values({
        id: nextStudentId(lastStudent?.id),
        fullName: data.fullName.trim(),
        fathersName: data.fathersName.trim(),
        course: data.course.trim(),
        dateOfJoining: data.dateOfJoining.toISOString().slice(0, 10),
        contactNumber: data.contactNumber.trim(),
        email,
        address: optionalText(data.address),
        guardianContact: optionalText(data.guardianContact),
        passwordHash: await hashPassword(data.password),
        plainPassword: data.password,
        branchId,
      })
      .returning();
    res.status(201).json(CreateStudentResponse.parse(studentView(student)));
  },
);

router.get(
  "/teacher/attendance",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = GetTeacherAttendanceQueryParams.safeParse(req.query);
    if (!parsed.success || !req.auth?.module) {
      res.status(400).json({ error: "Choose a valid week." });
      return;
    }
    const rows = await db
      .select({
        record: attendanceTable,
        studentName: studentsTable.fullName,
      })
      .from(attendanceTable)
      .innerJoin(studentsTable, eq(attendanceTable.studentId, studentsTable.id))
      .where(
        and(
          eq(attendanceTable.module, req.auth.module),
          eq(attendanceTable.week, parsed.data.week),
        ),
      );
    res.json(
      GetTeacherAttendanceResponse.parse(
        rows.map((row) => attendanceView(row.record, row.studentName)),
      ),
    );
  },
);

router.post(
  "/teacher/attendance/bulk",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = SaveTeacherAttendanceBody.safeParse(req.body);
    if (!parsed.success || !req.auth?.module) {
      res.status(400).json({ error: "Enter valid attendance records." });
      return;
    }
    for (const entry of parsed.data.records) {
      await db
        .insert(attendanceTable)
        .values({
          studentId: entry.studentId,
          module: req.auth.module,
          week: parsed.data.week,
          status: entry.status,
          recordedBy: Number(req.auth.userId),
        })
        .onConflictDoUpdate({
          target: [
            attendanceTable.studentId,
            attendanceTable.module,
            attendanceTable.week,
          ],
          set: {
            status: entry.status,
            recordedBy: Number(req.auth.userId),
            recordedAt: new Date(),
          },
        });
    }
    const rows = await db
      .select({
        record: attendanceTable,
        studentName: studentsTable.fullName,
      })
      .from(attendanceTable)
      .innerJoin(studentsTable, eq(attendanceTable.studentId, studentsTable.id))
      .where(
        and(
          eq(attendanceTable.module, req.auth.module),
          eq(attendanceTable.week, parsed.data.week),
        ),
      );
    res.json(
      SaveTeacherAttendanceResponse.parse(
        rows.map((row) => attendanceView(row.record, row.studentName)),
      ),
    );
  },
);

router.get(
  "/teacher/assessments",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = GetTeacherAssessmentsQueryParams.safeParse(req.query);
    if (!parsed.success || !req.auth?.module) {
      res.status(400).json({ error: "Choose a valid cycle." });
      return;
    }
    const rows = await db
      .select({
        record: assessmentsTable,
        studentName: studentsTable.fullName,
      })
      .from(assessmentsTable)
      .innerJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
      .where(
        and(
          eq(assessmentsTable.module, req.auth.module),
          eq(assessmentsTable.cycle, parsed.data.cycle),
        ),
      );
    res.json(
      GetTeacherAssessmentsResponse.parse(
        rows.map((row) => assessmentView(row.record, row.studentName)),
      ),
    );
  },
);

router.get(
  "/teacher/assessments/cycle-summary",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const rawCycle = Number(req.query.cycle ?? 1);
    const cycle = Number.isInteger(rawCycle) && rawCycle >= 1 ? rawCycle : 1;
    const [studentRows] = await db.select({ value: count() }).from(studentsTable);
    const totalStudents = Number(studentRows.value);
    const [markedRows] = await db
      .select({ value: count() })
      .from(assessmentsTable)
      .where(
        and(
          eq(assessmentsTable.module, req.auth.module),
          eq(assessmentsTable.cycle, cycle),
          isNotNull(assessmentsTable.marks),
        ),
      );
    const submitted = Number(markedRows.value);
    res.json({ totalStudents, submitted });
  },
);

router.post(
  "/teacher/assessments/bulk",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = SaveTeacherAssessmentsBody.safeParse(req.body);
    if (!parsed.success || !req.auth?.module) {
      res.status(400).json({ error: "Enter valid assessment records." });
      return;
    }
    for (const entry of parsed.data.records) {
      await db
        .insert(assessmentsTable)
        .values({
          studentId: entry.studentId,
          module: req.auth.module,
          cycle: parsed.data.cycle,
          marks: entry.marks,
          feedback: entry.feedback,
          projectName: optionalText(entry.projectName),
          enteredAt: new Date(),
          enteredBy: Number(req.auth.userId),
        })
        .onConflictDoUpdate({
          target: [
            assessmentsTable.studentId,
            assessmentsTable.module,
            assessmentsTable.cycle,
          ],
          set: {
            marks: entry.marks,
            feedback: entry.feedback,
            projectName: optionalText(entry.projectName),
            enteredAt: new Date(),
            enteredBy: Number(req.auth.userId),
          },
        });
    }
    const rows = await db
      .select({
        record: assessmentsTable,
        studentName: studentsTable.fullName,
      })
      .from(assessmentsTable)
      .innerJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
      .where(
        and(
          eq(assessmentsTable.module, req.auth.module),
          eq(assessmentsTable.cycle, parsed.data.cycle),
        ),
      );
    res.json(
      SaveTeacherAssessmentsResponse.parse(
        rows.map((row) => assessmentView(row.record, row.studentName)),
      ),
    );
  },
);

router.get(
  "/teacher/attendance/daily",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Missing module." });
      return;
    }
    const { studentId = "", month: rawMonth } = req.query as Record<string, string | undefined>;
    if (!studentId) {
      res.json([]);
      return;
    }
    // Omit ?month= to get every week — the calendar panel spans arbitrary months.
    const parsedMonth = Number(rawMonth);
    const month =
      rawMonth == null
        ? null
        : Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 6
          ? parsedMonth
          : 1;
    const weeks = month == null ? null : [1, 2, 3, 4].map((i) => (month - 1) * 4 + i);
    const rows = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.module, req.auth.module),
          eq(attendanceTable.studentId, studentId),
          ...(weeks ? [inArray(attendanceTable.week, weeks)] : []),
        ),
      )
      .orderBy(asc(attendanceTable.week));
    res.json(rows.map((record) => dayView(record)));
  },
);

router.post(
  "/teacher/attendance/bulk/daily",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Missing module." });
      return;
    }
    const body = (req.body ?? {}) as { studentId?: string; records?: { week?: number; mon?: boolean; tue?: boolean; wed?: boolean; thu?: boolean; fri?: boolean; sat?: boolean }[] };
    const studentId = typeof body.studentId === "string" ? body.studentId : "";
    const records = Array.isArray(body.records) ? body.records : [];
    if (!studentId || records.length === 0) {
      res.status(400).json({ error: "Enter valid attendance records." });
      return;
    }
    const savedWeeks: number[] = [];
    for (const entry of records) {
      const week = Number(entry.week);
      if (!Number.isInteger(week) || week < 1) continue;
      await db
        .insert(attendanceTable)
        .values({
          studentId,
          module: req.auth.module,
          week,
          status: "present",
          mon: Boolean(entry.mon),
          tue: Boolean(entry.tue),
          wed: Boolean(entry.wed),
          thu: Boolean(entry.thu),
          fri: Boolean(entry.fri),
          sat: Boolean(entry.sat),
          recordedBy: Number(req.auth.userId),
        })
        .onConflictDoUpdate({
          target: [
            attendanceTable.studentId,
            attendanceTable.module,
            attendanceTable.week,
          ],
          set: {
            status: "present",
            mon: Boolean(entry.mon),
            tue: Boolean(entry.tue),
            wed: Boolean(entry.wed),
            thu: Boolean(entry.thu),
            fri: Boolean(entry.fri),
            sat: Boolean(entry.sat),
            recordedBy: Number(req.auth.userId),
            recordedAt: new Date(),
          },
        });
      savedWeeks.push(week);
    }
    const rows = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.module, req.auth.module),
          eq(attendanceTable.studentId, studentId),
          inArray(attendanceTable.week, savedWeeks),
        ),
      )
      .orderBy(asc(attendanceTable.week));
    res.json(rows.map((record) => dayView(record)));
  },
);

router.get(
  "/admin/modules/:module/attendance",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const parsed = GetTeacherAttendanceQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a valid week." });
      return;
    }
    const rows = await db
      .select({
        record: attendanceTable,
        studentName: studentsTable.fullName,
      })
      .from(attendanceTable)
      .innerJoin(studentsTable, eq(attendanceTable.studentId, studentsTable.id))
      .where(
        and(
          eq(attendanceTable.module, module),
          eq(attendanceTable.week, parsed.data.week),
        ),
      );
    res.json(
      GetTeacherAttendanceResponse.parse(
        rows.map((row) => attendanceView(row.record, row.studentName)),
      ),
    );
  },
);

// Every attendance figure in the app is counted the same way: the course is six calendar
// months starting with the month the student was admitted in. Month 1 is whatever is left
// of the admission month — a student admitted on the 15th has a month 1 that runs 15th to
// the 31st, Sundays off — and each month after it is a whole calendar month. There are
// always exactly six of them and none is a stub.
// Sunday is never a teaching day.
const COURSE_MONTHS = 6;
const DAY_FLAG_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;

function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const copy = utcDay(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  return copy;
}

type CourseMonth = { month: number; start: string; end: string; days: string[] };

// The six calendar-month slices of one student's course. They start with the month the
// student was admitted in: slice 1 begins on the admission date and is clipped to the end
// of that calendar month, so a mid-month admission gets a short first month. Slices 2 to
// 6 are then whole calendar months.
//
// `events` are the institute-wide non-teaching days. They are dropped from `days`, which is
// what removes them from the percentage entirely — a PTM is neither present nor absent, and
// counting it as absent would punish students for a holiday.
function courseMonths(joinedOn: string | null, events: ReadonlyMap<string, string> = new Map()): CourseMonth[] {
  if (!joinedOn) return [];
  const joinDate = new Date(`${joinedOn}T00:00:00Z`);
  if (Number.isNaN(joinDate.getTime())) return [];
  const year = joinDate.getUTCFullYear();
  let month0 = joinDate.getUTCMonth();

  // Sunday is never a teaching day, so a student who enrols on the last Sunday of a month
  // would have a first month with nothing in it and every percentage after it measured
  // against a shifted window. Give them the whole next month as month 1 instead.
  let start = joinDate;
  for (;;) {
    const nextMonth = utcDay(year, month0 + 1, 1);
    const end = new Date(nextMonth.getTime() - 86_400_000);
    let teachingDays = 0;
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== 0) teachingDays += 1;
    }
    if (teachingDays > 0) break;
    // No teaching day is left this month: move the course on to the next one. A calendar
    // month always has one, so this can only ever run once.
    month0 += 1;
    start = utcDay(year, month0, 1);
  }

  const slices: CourseMonth[] = [];
  for (let index = 0; index < COURSE_MONTHS; index += 1) {
    const firstOfMonth = utcDay(year, month0 + index, 1);
    const nextMonth = utcDay(year, month0 + index + 1, 1);
    const sliceStart = index === 0 ? start : firstOfMonth;
    // The last day of the calendar month this slice belongs to.
    const end = new Date(nextMonth.getTime() - 86_400_000);
    if (end.getTime() < sliceStart.getTime()) break;
    const days: string[] = [];
    for (const d = new Date(sliceStart); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 0) continue; // Sunday is off
      const iso = isoDay(d);
      if (events.has(iso)) continue; // PTM, holiday, exam — not a teaching day at all
      days.push(iso);
    }
    slices.push({ month: slices.length + 1, start: isoDay(sliceStart), end: isoDay(end), days });
  }
  return slices;
}

// Attendance is stored as week-number + mon..sat flags, week 1 being the week the
// student joined. Turn each marked flag back into the real date it stands for.
function presentDatesByModule(
  joinedOn: string | null,
  rows: (typeof attendanceTable.$inferSelect)[],
): Map<string, Set<string>> {
  const byDate = new Map<string, Set<string>>();
  if (!joinedOn) return byDate;
  const anchor = mondayOf(new Date(`${joinedOn}T00:00:00Z`));
  for (const row of rows) {
    DAY_FLAG_ORDER.forEach((key, offset) => {
      if (!row[key]) return;
      const date = new Date(anchor);
      date.setUTCDate(date.getUTCDate() + (row.week - 1) * 7 + offset);
      const day = isoDay(date);
      if (!byDate.has(day)) byDate.set(day, new Set());
      byDate.get(day)!.add(row.module);
    });
  }
  return byDate;
}

// Institute-wide non-teaching days as plain YYYY-MM-DD strings, so they can be compared
// against the day strings `courseMonths` produces. Postgres hands `date` columns back as
// local-midnight Date objects, which read a day early in IST, so select the text form. The
// title rides along because the report says which event it was, not just that a day went.
async function eventDates(): Promise<Map<string, string>> {
  const rows = await db
    .select({ date: sql<string>`${calendarEventsTable.date}::text`, title: calendarEventsTable.title })
    .from(calendarEventsTable);
  return new Map(rows.map((row) => [row.date, row.title]));
}

async function buildStudentReport(studentId: string) {
  const [student] = await db
    .select({ dateOfJoining: studentsTable.dateOfJoining })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId))
    .limit(1);
  const attendanceRows = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.studentId, studentId))
    .orderBy(asc(attendanceTable.week));
  const assessmentRows = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.studentId, studentId))
    .orderBy(asc(assessmentsTable.cycle));

  const joinedOn = student?.dateOfJoining ?? null;
  const events = await eventDates();
  const slices = courseMonths(joinedOn, events);
  const presentOn = presentDatesByModule(joinedOn, attendanceRows);
  const moduleKeys = await studentModuleKeys(studentId);

  const months = slices.map((slice) => {
    const total = slice.days.length;
  const perModule = moduleKeys.map((module) => {
      const present = slice.days.filter((day) => presentOn.get(day)?.has(module)).length;
      return {
        module,
        present,
        absent: Math.max(0, total - present),
        total,
        percentage: total ? Math.round((present / total) * 100) : 0,
        recorded: present > 0,
        projects: [1, 2].map((project) => {
          const cycle = (slice.month - 1) * 2 + project;
          const record = assessmentRows.find(
            (row) => row.module === module && row.cycle === cycle,
          );
          return {
            project,
            cycle,
            marks: record?.marks ?? null,
            feedback: record?.feedback ?? null,
            projectName: record?.projectName ?? null,
          };
        }),
      };
    });
    // A day counts as attended when the student turned up for any module that day.
    const present = slice.days.filter((day) => (presentOn.get(day)?.size ?? 0) > 0).length;
    return {
      month: slice.month,
      start: slice.start,
      end: slice.end,
      present,
      absent: Math.max(0, total - present),
      total,
      // The event days inside this slice, with what each one was, so the UI can say why the
      // denominator is short instead of leaving a student wondering where days went. Counted
      // from start/end rather than from slice.days, because an event on a Sunday is a no-op
      // that must not be advertised as a lost day.
      events: [...events]
        .filter(([day]) => day >= slice.start && day <= slice.end)
        .map(([day, title]) => ({ date: day, title })),
      percentage: total ? Math.round((present / total) * 100) : 0,
      recorded: perModule.some((item) => item.recorded),
      modules: perModule,
    };
  });

  const overallPresent = months.reduce((sum, month) => sum + month.present, 0);
  const overallTotal = months.reduce((sum, month) => sum + month.total, 0);
  return {
    joinedOn,
    courseStart: slices[0]?.start ?? null,
    courseEnd: slices[slices.length - 1]?.end ?? null,
    overall: {
      present: overallPresent,
      absent: Math.max(0, overallTotal - overallPresent),
      total: overallTotal,
      percentage: overallTotal
        ? Math.round((overallPresent / overallTotal) * 100)
        : 0,
    },
    months,
  };
}


router.get(
  ["/admin/students/:id/report", "/teacher/students/:id/report"],
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    res.json(await buildStudentReport(String(req.params.id ?? "")));
  },
);

router.get(
  "/student/profile",
  requireRole("student"),
  async (req, res): Promise<void> => {
    if (!req.auth?.studentId) {
      res.status(401).json({ error: "Student session not found." });
      return;
    }
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, req.auth.studentId))
      .limit(1);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    // Straight off the students row, so whatever staff save on the student record is
    // what the student sees the next time they open this page. The staff remark stays
    // out of it.
    res.json({
      fullName: student.fullName,
      fathersName: student.fathersName,
      course: student.course,
      address: student.address,
      contactNumber: student.contactNumber,
      email: student.email,
      photo: student.photo,
    });
  },
);

// Students set their own profile picture. Same rules as the staff upload: a PNG/JPEG/
// WebP data URL (JSON, so Photo files are read client-side and cropped first), ≤1.5 MB.
router.patch(
  "/student/photo",
  requireRole("student"),
  async (req, res): Promise<void> => {
    if (!req.auth?.studentId) {
      res.status(401).json({ error: "Student session not found." });
      return;
    }
    const photo = req.body?.photo;
    if (photo !== null && typeof photo !== "string") {
      res.status(400).json({ error: "Send a photo data URL, or null to remove it." });
      return;
    }
    if (typeof photo === "string" && !/^data:image\/(png|jpeg|webp);base64,/.test(photo)) {
      res.status(400).json({ error: "Only PNG, JPEG or WebP images are accepted." });
      return;
    }
    if (typeof photo === "string" && photo.length > 1_500_000) {
      res.status(400).json({ error: "That image is too large." });
      return;
    }
    const [student] = await db
      .update(studentsTable)
      .set({ photo })
      .where(eq(studentsTable.id, req.auth.studentId))
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json({ photo: student.photo });
  },
);

router.get(
  "/student/monthly",
  requireRole("student"),
  async (req, res): Promise<void> => {
    if (!req.auth?.studentId) {
      res.status(401).json({ error: "Student session not found." });
      return;
    }
    res.json(await buildStudentReport(req.auth.studentId));
  },
);

// Admin and module owners run the same student screens, so these handlers are mounted
// on both prefixes; requestedRole() resolves the right session from the path.
const STUDENT_DETAIL_PATHS = ["/admin/students/:id/detail", "/teacher/students/:id/detail"];
const STUDENT_CREDENTIAL_PATHS = ["/admin/students/:id/credential", "/teacher/students/:id/credential"];
const STUDENT_PHOTO_PATHS = ["/admin/students/:id/photo", "/teacher/students/:id/photo"];

router.get(
  STUDENT_DETAIL_PATHS,
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, String(req.params.id ?? "")))
      .limit(1);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

// Kept off the list responses on purpose — only this call hands the password back.
router.get(
  STUDENT_CREDENTIAL_PATHS,
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const [student] = await db
      .select({ plainPassword: studentsTable.plainPassword })
      .from(studentsTable)
      .where(eq(studentsTable.id, String(req.params.id ?? "")))
      .limit(1);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json({ password: student.plainPassword });
  },
);

router.patch(
  STUDENT_PHOTO_PATHS,
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const photo = req.body?.photo;
    if (photo !== null && typeof photo !== "string") {
      res.status(400).json({ error: "Send a photo data URL, or null to remove it." });
      return;
    }
    if (typeof photo === "string" && !/^data:image\/(png|jpeg|webp);base64,/.test(photo)) {
      res.status(400).json({ error: "Only PNG, JPEG or WebP images are accepted." });
      return;
    }
    if (typeof photo === "string" && photo.length > 1_500_000) {
      res.status(400).json({ error: "That image is too large." });
      return;
    }
    const [student] = await db
      .update(studentsTable)
      .set({ photo })
      .where(eq(studentsTable.id, String(req.params.id ?? "")))
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

router.patch(
  ["/admin/students/:id/remark", "/teacher/students/:id/remark"],
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const raw = req.body?.remark;
    if (raw !== null && typeof raw !== "string") {
      res.status(400).json({ error: "Send a remark, or null to clear it." });
      return;
    }
    const remark = typeof raw === "string" ? raw.trim().slice(0, 2000) : null;
    const [student] = await db
      .update(studentsTable)
      .set({ remark: remark === "" ? null : remark })
      .where(eq(studentsTable.id, String(req.params.id ?? "")))
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

// Admin and module owners edit the same record. The email has to stay unique across
// the register, so a value already held by another student is refused (409).
router.patch(
  ["/admin/students/:id", "/teacher/students/:id"],
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const parsed = UpdateStudentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please complete all student fields correctly." });
      return;
    }
    const data = parsed.data;
    const id = String(req.params.id ?? "");
    const email = normalizeEmail(data.email);
    const [clash] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(and(eq(studentsTable.email, email), ne(studentsTable.id, id)))
      .limit(1);
    if (clash) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const [student] = await db
      .update(studentsTable)
      .set({
        fullName: data.fullName.trim(),
        fathersName: data.fathersName.trim(),
        course: data.course.trim(),
        dateOfJoining: data.dateOfJoining.toISOString().slice(0, 10),
        contactNumber: data.contactNumber.trim(),
        email,
        address: optionalText(data.address),
        guardianContact: optionalText(data.guardianContact),
      })
      .where(eq(studentsTable.id, id))
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

// Module owners manage the same roster, so they can remove a record too.
router.delete(
  "/teacher/students/:id",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const deleted = await db
      .delete(studentsTable)
      .where(eq(studentsTable.id, String(req.params.id ?? "")))
      .returning({ id: studentsTable.id });
    if (!deleted[0]) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.patch(
  "/teacher/students/:id/password",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = UpdateStudentPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid password." });
      return;
    }
    const [student] = await db
      .update(studentsTable)
      .set({
        passwordHash: await hashPassword(parsed.data.password),
        plainPassword: parsed.data.password,
      })
      .where(eq(studentsTable.id, String(req.params.id ?? "")))
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.sendStatus(204);
  },
);

// Which students this module has touched at all — the student list chips and the
// desk counters read the same thing, so they can never disagree.
router.get(
  "/teacher/overview/students",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    res.json(await buildStatus([req.auth.module]));
  },
);

// The module desk shows a period-free glance: how many students this module has
// touched at all. Week-by-week and project-by-project detail lives in the student list.
router.get(
  "/teacher/overview",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const [studentRows] = await db.select({ value: count() }).from(studentsTable);
    const totalStudents = Number(studentRows.value);
    const attendanceRows = await db
      .selectDistinct({ studentId: attendanceTable.studentId })
      .from(attendanceTable)
      .where(eq(attendanceTable.module, req.auth.module));
    const assessmentRows = await db
      .selectDistinct({ studentId: assessmentsTable.studentId })
      .from(assessmentsTable)
      .where(
        and(
          eq(assessmentsTable.module, req.auth.module),
          isNotNull(assessmentsTable.marks),
        ),
      );
    const attendanceMarked = attendanceRows.length;
    const assessmentMarked = assessmentRows.length;
    res.json({
      totalStudents,
      attendanceMarked,
      attendancePending: Math.max(0, totalStudents - attendanceMarked),
      assessmentMarked,
      assessmentPending: Math.max(0, totalStudents - assessmentMarked),
    });
  },
);

router.get(
  "/teacher/attendance/week-summary",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const rawWeek = Number(req.query.week ?? 1);
    const week = Number.isInteger(rawWeek) && rawWeek >= 1 ? rawWeek : 1;
    const [studentRows] = await db.select({ value: count() }).from(studentsTable);
    const totalStudents = Number(studentRows.value);
    const markedRows = await db
      .selectDistinct({ studentId: attendanceTable.studentId })
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.module, req.auth.module),
          eq(attendanceTable.week, week),
        ),
      );
    const uploaded = markedRows.length;
    res.json({
      totalStudents,
      uploaded,
      pending: Math.max(0, totalStudents - uploaded),
    });
  },
);

router.post(
  "/admin/modules/:module/attendance",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const parsed = SaveTeacherAttendanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter valid attendance records." });
      return;
    }
    for (const entry of parsed.data.records) {
      await db
        .insert(attendanceTable)
        .values({
          studentId: entry.studentId,
          module,
          week: parsed.data.week,
          status: entry.status,
          recordedByAdmin: Number(req.auth!.userId),
        })
        .onConflictDoUpdate({
          target: [
            attendanceTable.studentId,
            attendanceTable.module,
            attendanceTable.week,
          ],
          set: {
            status: entry.status,
            recordedByAdmin: Number(req.auth!.userId),
            recordedAt: new Date(),
          },
        });
    }
    const rows = await db
      .select({
        record: attendanceTable,
        studentName: studentsTable.fullName,
      })
      .from(attendanceTable)
      .innerJoin(studentsTable, eq(attendanceTable.studentId, studentsTable.id))
      .where(
        and(
          eq(attendanceTable.module, module),
          eq(attendanceTable.week, parsed.data.week),
        ),
      );
    res.json(
      SaveTeacherAttendanceResponse.parse(
        rows.map((row) => attendanceView(row.record, row.studentName)),
      ),
    );
  },
);

router.get(
  "/admin/modules/:module/attendance/daily",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const studentId = typeof req.query.studentId === "string" ? req.query.studentId : undefined;
    if (!studentId) {
      res.status(400).json({ error: "Choose a student." });
      return;
    }
    const rows = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.module, module),
          eq(attendanceTable.studentId, studentId),
        ),
      )
      .orderBy(asc(attendanceTable.week));
    res.json(rows);
  },
);

router.post(
  "/admin/modules/:module/attendance/daily",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const body = req.body as {
      studentId?: unknown;
      records?: unknown;
    };
    if (
      typeof body.studentId !== "string" ||
      !body.studentId ||
      !Array.isArray(body.records)
    ) {
      res.status(400).json({ error: "Enter valid attendance records." });
      return;
    }
    for (const raw of body.records) {
      const entry = raw as Record<string, unknown>;
      const week = Number(entry.week);
      const days = ["mon", "tue", "wed", "thu", "fri", "sat"];
      if (
        !Number.isInteger(week) ||
        week < 1 ||
        week > 52 ||
        !days.every((day) => typeof entry[day] === "boolean")
      ) {
        res.status(400).json({ error: "Enter valid attendance records." });
        return;
      }
      const mon = entry.mon as boolean;
      const tue = entry.tue as boolean;
      const wed = entry.wed as boolean;
      const thu = entry.thu as boolean;
      const fri = entry.fri as boolean;
      const sat = entry.sat as boolean;
      const presentDays = [mon, tue, wed, thu, fri, sat].filter(Boolean).length;
      const status = presentDays >= 4 ? "present" : "absent";
      await db
        .insert(attendanceTable)
        .values({
          studentId: body.studentId,
          module,
          week,
          status,
          mon,
          tue,
          wed,
          thu,
          fri,
          sat,
          recordedByAdmin: Number(req.auth!.userId),
        })
        .onConflictDoUpdate({
          target: [
            attendanceTable.studentId,
            attendanceTable.module,
            attendanceTable.week,
          ],
          set: { status, mon, tue, wed, thu, fri, sat, recordedByAdmin: Number(req.auth!.userId), recordedAt: new Date() },
        });
    }
    res.json({ ok: true });
  },
);

// The picker is a calendar month ("2026-09"). Counts are taken from the students whose
// course actually covers that calendar month, not the roster as a whole — enrollment is
// per student, so a month where ten students joined lists ten, a later month where five
// more joined lists fifteen. A student's slices are calendar-aligned by construction, so
// the slice whose start falls in the picked month IS their enrollment record for it.
router.get(
  "/admin/modules/:module/attendance/summary",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const rawMonth = typeof req.query.month === "string" ? req.query.month : "";
    const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : isoDay(new Date()).slice(0, 7);
    const branchId = typeof req.query.branchId === "string" ? Number(req.query.branchId) : null;

    const students = await db
      .select({ id: studentsTable.id, dateOfJoining: studentsTable.dateOfJoining, branchId: studentsTable.branchId })
      .from(studentsTable)
      .where(branchId != null ? eq(studentsTable.branchId, branchId) : undefined);
    const studentIds = students.map((s) => s.id);
    const attendanceRows = await db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.module, module), inArray(attendanceTable.studentId, studentIds)));
    const byStudent = new Map<string, (typeof attendanceTable.$inferSelect)[]>();
    for (const row of attendanceRows) {
      byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row]);
    }
    const assessments = await db
      .select()
      .from(assessmentsTable)
      .where(and(eq(assessmentsTable.module, module), inArray(assessmentsTable.studentId, studentIds)));

    const events = await eventDates();

    // The month picker is offered every month in which at least one student's course
    // ran. Empty months between two covered ones still show a zero — skipping them
    // would make the next month look adjacent.
    const monthKeys = new Set<string>();
    for (const student of students) {
      for (const slice of courseMonths(student.dateOfJoining, events)) {
        if (slice.start) monthKeys.add(slice.start.slice(0, 7));
      }
    }
    const months = [...monthKeys].sort();
    const currentKey = isoDay(new Date()).slice(0, 7);
    if (months.length > 0 && currentKey >= months[0] && currentKey <= months[months.length - 1]) {
      monthKeys.add(currentKey);
    }
    const orderedMonths = [...monthKeys].sort();

    let studentsMarked = 0;
    let presentDays = 0;
    let possibleDays = 0;
    let projectOneMarked = 0;
    let projectTwoMarked = 0;
    for (const student of students) {
      const slice = courseMonths(student.dateOfJoining, events).find(
        (s) => s.start && s.start.slice(0, 7) === monthKey,
      );
      if (!slice) continue; // not enrolled during this calendar month
      possibleDays += slice.days.length;
      const presentOn = presentDatesByModule(
        student.dateOfJoining,
        byStudent.get(student.id) ?? [],
      );
      const present = slice.days.filter((day) => presentOn.get(day)?.has(module)).length;
      presentDays += present;
      if (present > 0) studentsMarked += 1;

      // Project four-and-two never line up across students: cycle numbers are relative
      // to each joining date, so for this calendar month each student has their own
      // pair. What stays common is the project slot — project 1 of *their* month.
      const cycle1 = (slice.month - 1) * 2 + 1;
      const cycle2 = (slice.month - 1) * 2 + 2;
      const own = assessments.filter((a) => a.studentId === student.id);
      if (own.find((a) => a.cycle === cycle1 && a.marks != null)) projectOneMarked += 1;
      if (own.find((a) => a.cycle === cycle2 && a.marks != null)) projectTwoMarked += 1;
    }

    const totalStudents = students.reduce(
      (sum, student) =>
        sum +
        (courseMonths(student.dateOfJoining, events).some(
          (s) => s.start && s.start.slice(0, 7) === monthKey,
        )
          ? 1
          : 0),
      0,
    );

    res.json({
      month: monthKey,
      months: orderedMonths,
      totalStudents,
      studentsMarked,
      studentsPending: Math.max(0, totalStudents - studentsMarked),
      marked: presentDays,
      expected: possibleDays,
      pending: Math.max(0, possibleDays - presentDays),
      assessmentMarked: projectOneMarked + projectTwoMarked,
      projects: [
        { project: 1, marked: projectOneMarked },
        { project: 2, marked: projectTwoMarked },
      ],
    });
  },
);

router.get(
  "/admin/modules/:module/activity",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const [attendanceRows] = await db
      .select({ value: max(attendanceTable.week) })
      .from(attendanceTable)
      .where(eq(attendanceTable.module, module));
    const [assessmentRows] = await db
      .select({ value: max(assessmentsTable.cycle) })
      .from(assessmentsTable)
      .where(
        and(
          eq(assessmentsTable.module, module),
          isNotNull(assessmentsTable.marks),
        ),
      );
    res.json({
      latestWeek: attendanceRows?.value ? Number(attendanceRows.value) : null,
      latestCycle: assessmentRows?.value ? Number(assessmentRows.value) : null,
    });
  },
);

router.get(
  "/admin/modules/:module/assessments",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const parsed = GetTeacherAssessmentsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a valid cycle." });
      return;
    }
    const rows = await db
      .select({
        record: assessmentsTable,
        studentName: studentsTable.fullName,
      })
      .from(assessmentsTable)
      .innerJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
      .where(
        and(
          eq(assessmentsTable.module, module),
          eq(assessmentsTable.cycle, parsed.data.cycle),
        ),
      );
    res.json(
      GetTeacherAssessmentsResponse.parse(
        rows.map((row) => assessmentView(row.record, row.studentName)),
      ),
    );
  },
);

router.post(
  "/admin/modules/:module/assessments",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const parsed = SaveTeacherAssessmentsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter valid assessment records." });
      return;
    }
    for (const entry of parsed.data.records) {
      await db
        .insert(assessmentsTable)
        .values({
          studentId: entry.studentId,
          module,
          cycle: parsed.data.cycle,
          marks: entry.marks,
          feedback: entry.feedback,
          enteredAt: new Date(),
          enteredByAdmin: Number(req.auth!.userId),
        })
        .onConflictDoUpdate({
          target: [
            assessmentsTable.studentId,
            assessmentsTable.module,
            assessmentsTable.cycle,
          ],
          set: {
            marks: entry.marks,
            feedback: entry.feedback,
            enteredAt: new Date(),
            enteredByAdmin: Number(req.auth!.userId),
          },
        });
    }
    const rows = await db
      .select({
        record: assessmentsTable,
        studentName: studentsTable.fullName,
      })
      .from(assessmentsTable)
      .innerJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
      .where(
        and(
          eq(assessmentsTable.module, module),
          eq(assessmentsTable.cycle, parsed.data.cycle),
        ),
      );
    res.json(
      SaveTeacherAssessmentsResponse.parse(
        rows.map((row) => assessmentView(row.record, row.studentName)),
      ),
    );
  },
);

router.get(
  "/student/attendance",
  requireRole("student"),
  async (req, res): Promise<void> => {
    if (!req.auth?.studentId) {
      res.status(401).json({ error: "Student session not found." });
      return;
    }
    const rows = await db
      .select()
      .from(attendanceTable)
      .where(eq(attendanceTable.studentId, req.auth.studentId))
      .orderBy(asc(attendanceTable.week));
    const summary = (await studentModuleKeys(req.auth.studentId)).map((module) => {
      const moduleRows = rows.filter((row) => row.module === module);
      const present = moduleRows.filter((row) => row.status === "present").length;
      return {
        module,
        present,
        recorded: moduleRows.length,
        percentage: moduleRows.length
          ? Math.round((present / moduleRows.length) * 100)
          : 0,
      };
    });
    const weeks = Array.from(
      { length: Math.max(DEFAULT_WEEKS, ...rows.map((row) => row.week)) },
      (_, index) => {
        const week = index + 1;
        const atWeek = rows.filter((row) => row.week === week);
        return {
          week,
          ai: atWeek.find((row) => row.module === "ai")?.status ?? null,
          dm: atWeek.find((row) => row.module === "dm")?.status ?? null,
          sm: atWeek.find((row) => row.module === "sm")?.status ?? null,
        };
      },
    );
    res.json(GetStudentAttendanceReportResponse.parse({ summary, weeks }));
  },
);

router.get(
  "/student/assessments",
  requireRole("student"),
  async (req, res): Promise<void> => {
    if (!req.auth?.studentId) {
      res.status(401).json({ error: "Student session not found." });
      return;
    }
    const rows = await db
      .select()
      .from(assessmentsTable)
      .where(eq(assessmentsTable.studentId, req.auth.studentId))
      .orderBy(asc(assessmentsTable.cycle));
    const report = Object.fromEntries(
      (await studentModuleKeys(req.auth.studentId)).map((module) => [
        module,
        Array.from(
          { length: Math.max(DEFAULT_CYCLES, ...rows.map((row) => row.cycle)) },
          (_, index) => {
            const cycle = index + 1;
            const found = rows.find(
              (row) => row.module === module && row.cycle === cycle,
            );
            return found
              ? assessmentView(found)
              : {
                  studentId: req.auth?.studentId ?? "",
                  studentName: "",
                  module,
                  cycle,
                  marks: null,
                  feedback: null,
                  enteredAt: null,
                };
          },
        ),
      ]),
    );
    res.json(GetStudentAssessmentReportResponse.parse(report));
  },
);

// ------------------------------------------------------------ up-to-date as of today
// The two icons on the student list answer "is anything outstanding right now", so
// both are measured against today rather than against the whole course.

function todayIso(): string {
  return isoDay(new Date());
}

// A teaching day counts as dealt with once it was explicitly saved (its lock bit is
// set), or a present flag was recorded before locking existed.
function handledDatesByModule(
  joinedOn: string | null,
  rows: (typeof attendanceTable.$inferSelect)[],
): Map<string, Set<string>> {
  const byDate = new Map<string, Set<string>>();
  if (!joinedOn) return byDate;
  const anchor = mondayOf(new Date(`${joinedOn}T00:00:00Z`));
  for (const row of rows) {
    DAY_FLAG_ORDER.forEach((key, offset) => {
      if (!row[key] && !isLocked(row.lockedDays, key)) return;
      const date = new Date(anchor);
      date.setUTCDate(date.getUTCDate() + (row.week - 1) * 7 + offset);
      const day = isoDay(date);
      if (!byDate.has(day)) byDate.set(day, new Set());
      byDate.get(day)!.add(row.module);
    });
  }
  return byDate;
}

// Today only: green once the current date has been marked, and the next day turns it
// outstanding again until that day is marked too. The one exception is Sunday, which is
// not a teaching day, so nothing is due from anybody. A student whose course has not
// started (or has finished) still counts as outstanding — today's attendance is simply
// not on record for them.
function attendancePendingFor(
  joinedOn: string | null,
  rows: (typeof attendanceTable.$inferSelect)[],
  module: Module,
  today: string,
  isEvent = false,
): number {
  const date = new Date(`${today}T00:00:00Z`);
  if ((date.getUTCDay() + 6) % 7 > 5) return 0; // Sunday
  if (isEvent) return 0; // a PTM or holiday: nobody was marked, nobody is at fault
  const slot = weekAndDayFor(joinedOn, date);
  if (!slot) return 1; // outside this student's course — nothing recorded for today
  const row = rows.find((r) => r.module === module && r.week === slot.week);
  const done = row ? row[slot.day] || isLocked(row.lockedDays, slot.day) : false;
  return done ? 0 : 1;
}

// Two projects a month: the first falls due halfway through the month, the second at
// the end of it. Only projects whose date has passed count as outstanding.
function marksPendingFor(
  joinedOn: string | null,
  rows: (typeof assessmentsTable.$inferSelect)[],
  module: Module,
  today: string,
  events: ReadonlyMap<string, string> = new Map(),
): number {
  let pending = 0;
  for (const slice of courseMonths(joinedOn, events)) {
    const start = new Date(`${slice.start}T00:00:00Z`).getTime();
    const end = new Date(`${slice.end}T00:00:00Z`).getTime();
    const dueDates = [isoDay(new Date(start + Math.floor((end - start) / 2))), slice.end];
    dueDates.forEach((due, index) => {
      if (today <= due) return; // not due yet
      const cycle = (slice.month - 1) * 2 + index + 1;
      const record = rows.find((row) => row.module === module && row.cycle === cycle);
      if (record?.marks == null) pending += 1;
    });
  }
  return pending;
}

type StatusPayload = {
  attendance: string[];
  assessment: string[];
  pendingAttendance: Record<string, number>;
  pendingMarks: Record<string, number>;
};

// Shared by both portals: the module desk asks about its own module, the admin asks
// about all three at once and a student is only clear when nothing anywhere is due.
async function buildStatus(scope: readonly Module[]): Promise<StatusPayload> {
  const today = todayIso();
  const students = await db
    .select({ id: studentsTable.id, dateOfJoining: studentsTable.dateOfJoining })
    .from(studentsTable);
  const attendanceRows = await db.select().from(attendanceTable);
  const assessmentRows = await db.select().from(assessmentsTable);
  const events = await eventDates();
  const isEventToday = events.has(today);

  const payload: StatusPayload = {
    attendance: [],
    assessment: [],
    pendingAttendance: {},
    pendingMarks: {},
  };
  for (const student of students) {
    const ownAttendance = attendanceRows.filter((row) => row.studentId === student.id);
    const ownAssessments = assessmentRows.filter((row) => row.studentId === student.id);
    let attendancePending = 0;
    let marksPending = 0;
    for (const module of scope) {
      attendancePending += attendancePendingFor(
        student.dateOfJoining,
        ownAttendance.filter((row) => row.module === module),
        module,
        today,
        isEventToday,
      );
      marksPending += marksPendingFor(student.dateOfJoining, ownAssessments, module, today, events);
    }
    payload.pendingAttendance[student.id] = attendancePending;
    payload.pendingMarks[student.id] = marksPending;
    if (attendancePending === 0) payload.attendance.push(student.id);
    if (marksPending === 0) payload.assessment.push(student.id);
  }
  return payload;
}

// ---------------------------------------------------------------- day status
// The module desk and the admin module page both answer the same question: how did this
// module do on *this* day. Every counter moves with the date rather than describing the
// whole course at once, so a back date can be read the same way today is.
//
// An event day reports the event instead of counts — nobody was marked on it and it is
// not in anyone's percentage. Sunday was never a teaching day, so it is equally empty.
async function buildDayStatus(module: Module, date: Date, branchId?: number | null) {
  const iso = isoDay(date);
  const events = await eventDates();
  const eventTitle = events.get(iso) ?? null;
  const sunday = (date.getUTCDay() + 6) % 7 > 5;
  const students = await db
    .select()
    .from(studentsTable)
    .where(branchId != null ? eq(studentsTable.branchId, branchId) : undefined)
    .orderBy(asc(studentsTable.fullName));
  const studentIds = (await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(branchId != null ? eq(studentsTable.branchId, branchId) : undefined))
    .map((s) => s.id);
  const attendanceRows = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.module, module), inArray(attendanceTable.studentId, studentIds)));
  const assessmentRows = await db
    .select()
    .from(assessmentsTable)
    .where(and(eq(assessmentsTable.module, module), inArray(assessmentsTable.studentId, studentIds)));

  const result = {
    date: iso,
    sunday,
    event: eventTitle == null ? null : { date: iso, title: eventTitle },
    totalStudents: students.length,
    // eligible = students whose course is actually running on this date. Someone who has
    // not joined yet cannot be present, absent or on leave, so they are not counted here —
    // the roster total above still includes them.
    eligible: 0,
    present: 0,
    absent: 0,
    leave: 0,
    unmarked: 0,
    assessmentMarked: 0,
    assessmentPending: 0,
  };
  if (eventTitle != null || sunday) return result;

  for (const student of students) {
    const slot = weekAndDayFor(student.dateOfJoining, date);
    if (slot) {
      result.eligible += 1;
      const row = attendanceRows.find((r) => r.studentId === student.id && r.week === slot.week);
      const onLeave = row ? ((row.leaveDays ?? 0) & dayBit(slot.day)) !== 0 : false;
      const markedPresent = row ? Boolean(row[slot.day]) : false;
      // Leave records the day flag as present too, so it needs its own bucket here or it
      // would be counted as present and nobody would see it.
      if (onLeave) result.leave += 1;
      else if (markedPresent) result.present += 1;
      // A recorded absent and a day nobody touched both leave the day flag false; the
      // locked bit is the only thing that tells them apart.
      else if (row && isLocked(row.lockedDays, slot.day)) result.absent += 1;
      else result.unmarked += 1;
    }

    // Marks count the projects that have fallen due by this date. Only for students inside
    // their course: a finished course must not sit at "pending" forever.
    const inCourse = courseMonths(student.dateOfJoining, events)
      .some((slice) => iso >= slice.start && iso <= slice.end);
    if (inCourse) {
      const due = marksPendingFor(student.dateOfJoining, assessmentRows, module, iso, events);
      if (due === 0) result.assessmentMarked += 1;
      else result.assessmentPending += due;
    }
  }
  return result;
}

router.get(
  "/teacher/day-status",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Missing module." });
      return;
    }
    const date = parseDayParam(req.query.date);
    if (!date) {
      res.status(400).json({ error: "Choose a valid date." });
      return;
    }
    res.json(await buildDayStatus(req.auth.module, date));
  },
);

router.get(
  "/admin/modules/:module/day-status",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const date = parseDayParam(req.query.date);
    if (!date) {
      res.status(400).json({ error: "Choose a valid date." });
      return;
    }
    const branchId = typeof req.query.branchId === "string" ? Number(req.query.branchId) : null;
    res.json(await buildDayStatus(module, date, branchId));
  },
);

// Branch module day status — mirrors admin but scoped to the session's branch.
router.get(
  "/branch/modules/:module/day-status",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = req.params.module as Module;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const date = parseDayParam(req.query.date);
    if (!date) {
      res.status(400).json({ error: "Choose a valid date." });
      return;
    }
    res.json(await buildDayStatus(module, date, req.auth.branchId));
  },
);

// ---------------------------------------------------------------- day register
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Week numbers are per student — week 1 is the week that student joined — so one
// calendar date lands on a different week row for each student.
function weekAndDayFor(
  joinedOn: string | null,
  date: Date,
): { week: number; day: (typeof DAY_FLAG_ORDER)[number] } | null {
  if (!joinedOn) return null;
  const joinDate = new Date(`${joinedOn}T00:00:00Z`);
  if (Number.isNaN(joinDate.getTime())) return null;
  const index = (date.getUTCDay() + 6) % 7;
  if (index > 5) return null; // Sunday is not a teaching day
  const week =
    Math.round(
      (mondayOf(date).getTime() - mondayOf(joinDate).getTime()) / WEEK_MS,
    ) + 1;
  if (week < 1) return null; // before this student enrolled
  const day = DAY_FLAG_ORDER[index];
  return day ? { week, day } : null;
}

function dayBit(day: (typeof DAY_FLAG_ORDER)[number]): number {
  return 1 << DAY_FLAG_ORDER.indexOf(day);
}

function isLocked(lockedDays: number | null | undefined, day: (typeof DAY_FLAG_ORDER)[number]): boolean {
  return ((lockedDays ?? 0) & dayBit(day)) !== 0;
}

function parseDayParam(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// One row per student for a single calendar date, so a module owner can fill the
// whole register in one pass instead of opening each student's calendar.
router.get(
  "/teacher/attendance/day",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Missing module." });
      return;
    }
    const date = parseDayParam(req.query.date);
    if (!date) {
      res.status(400).json({ error: "Choose a valid date." });
      return;
    }
    const students = await db
      .select()
      .from(studentsTable)
      .orderBy(asc(studentsTable.fullName));
    const rows = await db
      .select()
      .from(attendanceTable)
      .where(eq(attendanceTable.module, req.auth.module));

    res.json(
      students.map((student) => {
        const slot = weekAndDayFor(student.dateOfJoining, date);
        const row = slot
          ? rows.find((r) => r.studentId === student.id && r.week === slot.week)
          : undefined;
        return {
          ...studentView(student),
          week: slot?.week ?? null,
          // eligible = the date sits inside this student's course and is not a Sunday
          eligible: slot != null,
          present: slot && row ? Boolean(row[slot.day]) : false,
          // On leave records the day flag as present too; this bit tells them apart.
          leave: slot && row ? ((row.leaveDays ?? 0) & dayBit(slot.day)) !== 0 : false,
          recorded: Boolean(row),
          // Whether THIS day has actually been saved for the student — the lock bit is
          // what distinguishes "explicitly absent" from "the week row exists but
          // nobody touched today yet".
          markedToday: slot && row ? Boolean(row[slot.day]) || isLocked(row.lockedDays, slot.day) : false,
        };
      }),
    );
  },
);

// Ticked students become present, the leave list becomes leave (which still counts as
// attended), the rest of the submitted list becomes absent, and anyone left out of all
// three arrays keeps whatever they already had. Days stay editable: saving again just
// overwrites the day, so a mistake can be fixed.
router.post(
  "/teacher/attendance/day",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Missing module." });
      return;
    }
    const body = (req.body ?? {}) as {
      date?: string;
      present?: unknown;
      absent?: unknown;
      leave?: unknown;
    };
    const date = parseDayParam(body.date);
    const present = Array.isArray(body.present)
      ? body.present.filter((id): id is string => typeof id === "string")
      : [];
    const absent = Array.isArray(body.absent)
      ? body.absent.filter((id): id is string => typeof id === "string")
      : [];
    const leave = Array.isArray(body.leave)
      ? body.leave.filter((id): id is string => typeof id === "string")
      : [];
    if (!date || present.length + absent.length + leave.length === 0) {
      res.status(400).json({ error: "Choose a date and at least one student." });
      return;
    }

    const touched = [...new Set([...present, ...absent, ...leave])];
    const students = await db
      .select({ id: studentsTable.id, dateOfJoining: studentsTable.dateOfJoining })
      .from(studentsTable)
      .where(inArray(studentsTable.id, touched));
    const existing = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.module, req.auth.module),
          inArray(attendanceTable.studentId, touched),
        ),
      );

    const presentSet = new Set(present);
    const leaveSet = new Set(leave);
    let saved = 0;
    let skipped = 0;
    for (const student of students) {
      const slot = weekAndDayFor(student.dateOfJoining, date);
      if (!slot) {
        skipped += 1;
        continue;
      }
      const row = existing.find(
        (r) => r.studentId === student.id && r.week === slot.week,
      );
      // Only this one day moves; the rest of the week keeps whatever it held.
      const flags = Object.fromEntries(
        DAY_FLAG_ORDER.map((key) => [key, row ? Boolean(row[key]) : false]),
      ) as Record<(typeof DAY_FLAG_ORDER)[number], boolean>;
      flags[slot.day] = presentSet.has(student.id) || leaveSet.has(student.id);
      // Leave marks the day attended, but the leave bit says why.
      const leaveDays = leaveSet.has(student.id)
        ? (row?.leaveDays ?? 0) | dayBit(slot.day)
        : (row?.leaveDays ?? 0) & ~dayBit(slot.day);
      // The lock bits are still written so "today was handled" stays derivable for the
      // status icons (an absence leaves the day flag false), but they no longer refuse
      // an edit — this day is saved as whatever was just submitted.
      const lockedDays = (row?.lockedDays ?? 0) | dayBit(slot.day);
      await db
        .insert(attendanceTable)
        .values({
          studentId: student.id,
          module: req.auth.module,
          week: slot.week,
          status: "present",
          ...flags,
          leaveDays,
          lockedDays,
          recordedBy: Number(req.auth.userId),
        })
        .onConflictDoUpdate({
          target: [
            attendanceTable.studentId,
            attendanceTable.module,
            attendanceTable.week,
          ],
          set: {
            status: "present",
            ...flags,
            leaveDays,
            lockedDays,
            recordedBy: Number(req.auth.userId),
            recordedAt: new Date(),
          },
        });
      saved += 1;
    }
    res.json({ saved, skipped });
  },
);

// ---------------------------------------------------------------- institute events
// A PTM, a holiday or an exam that stops all three modules on one day. Recorded once by
// whichever desk noticed it first and shown to everyone, because the institute closes as a
// whole — which is also why the day leaves the attendance percentage entirely rather than
// counting as an absence (`courseMonths` drops it).

const EVENT_TYPES = ["holiday", "event", "meeting", "other"] as const;

function eventView(record: typeof calendarEventsTable.$inferSelect) {
  return {
    // Drizzle hands this back as the plain string it was written as, so no reformatting.
    date: record.date,
    title: record.title,
    type: record.type ?? "event",
  };
}

router.get(
  ["/admin/events", "/teacher/events", "/student/events"],
  requireRole("admin", "teacher", "student"),
  async (req, res): Promise<void> => {
    // A range keeps the response small on a long course; without one the desk asks for the
    // single date it is showing, which is the common case.
    const from = typeof req.query["from"] === "string" ? req.query["from"] : null;
    const to = typeof req.query["to"] === "string" ? req.query["to"] : null;
    const where = from
      ? to
        ? and(gte(calendarEventsTable.date, from), lte(calendarEventsTable.date, to))
        : gte(calendarEventsTable.date, from)
      : undefined;
    const rows = await db
      .select()
      .from(calendarEventsTable)
      .where(where)
      .orderBy(asc(calendarEventsTable.date));
    res.json(rows.map(eventView));
  },
);

router.post(
  ["/admin/events", "/teacher/events"],
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const raw = (req.body ?? {}) as { date?: unknown; title?: unknown; type?: unknown };
    const date = typeof raw.date === "string" ? raw.date.trim() : "";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const type = typeof raw.type === "string" && (EVENT_TYPES as readonly string[]).includes(raw.type)
      ? raw.type
      : "event";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
      res.status(400).json({ error: "Pick the date this event falls on." });
      return;
    }
    if (!title) {
      res.status(400).json({ error: "Say what the event was, e.g. PTM or Diwali holiday." });
      return;
    }
    // One entry per date: a second desk saving the same day corrects the first rather than
    // stacking a duplicate on top of it.
    const row: typeof calendarEventsTable.$inferInsert = {
      date,
      title,
      type,
      createdBy: req.auth?.role === "teacher" ? Number(req.auth.userId) : null,
      createdByAdmin: req.auth?.role === "admin" ? Number(req.auth.userId) : null,
    };
    const [saved] = await db
      .insert(calendarEventsTable)
      .values(row)
      .onConflictDoUpdate({
        target: calendarEventsTable.date,
        set: { title: row.title, type: row.type },
      })
      .returning();
    if (!saved) {
      res.status(500).json({ error: "Could not save that event." });
      return;
    }
    res.json(eventView(saved));
  },
);

router.delete(
  ["/admin/events/:date", "/teacher/events/:date"],
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const rawDate = req.params["date"];
    const date = Array.isArray(rawDate) ? (rawDate[0] ?? "") : (rawDate ?? "");
    // A `date` column compared against text would not match, and an unparseable value would
    // throw inside Postgres rather than returning nothing.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "That is not a date we can remove." });
      return;
    }
    const [deleted] = await db
      .delete(calendarEventsTable)
      .where(eq(sql`${calendarEventsTable.date}::text`, date))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "There is no event on that date." });
      return;
    }
    res.status(204).end();
  },
);

// ---------------------------------------------------------------- branches & modules
// Branches have admin-created modules. The public/catalog variant drives the student
// registration branch picker; the admin one is used by the dashboard.
router.get(
  "/catalog/branches",
  async (_req, res): Promise<void> => {
    const branches = await db.select().from(branchesTable).orderBy(asc(branchesTable.name));
    const modules = await db.select().from(modulesCatalog).orderBy(asc(modulesCatalog.name));
    res.json(branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      modules: modules.filter((m) => m.branchId === branch.id).map((m) => ({ id: m.id, name: m.name })),
    })));
  },
);

router.get(
  "/admin/branches",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const branches = await db.select().from(branchesTable).orderBy(asc(branchesTable.name));
    const modules = await db.select().from(modulesCatalog).orderBy(asc(modulesCatalog.name));
    res.json(branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      username: branch.username ?? null,
      plainPassword: branch.plainPassword ?? null,
      modules: modules.filter((m) => m.branchId === branch.id),
    })));
  },
);

router.post(
  "/admin/branches",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const body = req.body as { name?: unknown; username?: unknown; password?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const username = typeof body.username === "string" && body.username.trim() ? body.username.trim() : null;
    const password = typeof body.password === "string" ? body.password : null;
    if (!name) {
      res.status(400).json({ error: "Enter a branch name." });
      return;
    }
    if (username != null && (password == null || password.length < 6)) {
      res.status(400).json({ error: "Enter a password of at least 6 characters for the branch login." });
      return;
    }
    if (username != null) {
      const [dup] = await db
        .select({ id: branchesTable.id })
        .from(branchesTable)
        .where(eq(branchesTable.username, username))
        .limit(1);
      if (dup) {
        res.status(409).json({ error: "That user ID is already in use." });
        return;
      }
    }
    const [branch] = await db
      .insert(branchesTable)
      .values({
        name,
        username: username ?? undefined,
        passwordHash: username && password ? await hashPassword(password) : undefined,
        plainPassword: username && password ? password : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!branch) {
      res.status(409).json({ error: "A branch with that name already exists." });
      return;
    }
    res.status(201).json(branch);
  },
);

router.patch(
  "/admin/branches/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId)) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const body = req.body as { name?: unknown; username?: unknown };
    const updates: { name?: string; username?: string } = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.username === "string" && body.username.trim()) updates.username = body.username.trim();
    if (!updates.name && !updates.username) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, branchId)).limit(1);
    if (!branch) {
      res.status(404).json({ error: "Branch not found." });
      return;
    }
    if (updates.name) {
      const [dupName] = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(eq(branchesTable.name, updates.name), ne(branchesTable.id, branchId))).limit(1);
      if (dupName) {
        res.status(409).json({ error: "A branch with that name already exists." });
        return;
      }
    }
    if (updates.username) {
      const [dupUser] = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(eq(branchesTable.username, updates.username), ne(branchesTable.id, branchId))).limit(1);
      if (dupUser) {
        res.status(409).json({ error: "That user ID is already in use." });
        return;
      }
    }
    const [updated] = await db.update(branchesTable).set(updates).where(eq(branchesTable.id, branchId)).returning();
    res.json({ id: updated.id, name: updated.name, username: updated.username ?? null });
  },
);

router.delete(
  "/admin/branches/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId)) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    await db.delete(branchesTable).where(eq(branchesTable.id, branchId));
    res.status(204).end();
  },
);

router.post(
  "/admin/modules",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const body = req.body as { branchId?: unknown; name?: unknown };
    const branchId = typeof body.branchId === "number" ? body.branchId : Number(body.branchId);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!Number.isInteger(branchId) || !name) {
      res.status(400).json({ error: "Enter a branch and a module name." });
      return;
    }
    const [branch] = await db
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(eq(branchesTable.id, branchId))
      .limit(1);
    if (!branch) {
      res.status(404).json({ error: "Branch not found." });
      return;
    }
    // Build a stable id from the name, and fall back to a numeric suffix on collision.
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let candidate = slug || 'module';
    let n = 2;
    for (;;) {
      const [exists] = await db
        .select({ id: modulesCatalog.id })
        .from(modulesCatalog)
        .where(eq(modulesCatalog.id, candidate))
        .limit(1);
      if (!exists) break;
      candidate = `${slug || 'module'}-${n++}`;
    }
    const [mod] = await db
      .insert(modulesCatalog)
      .values({ id: candidate, branchId, name })
      .returning();
    res.status(201).json(mod);
  },
);

// A branch holds exactly one desk login: the admin assigns one userid/password
// here, and from then on it can only be changed.
router.post(
  "/admin/branches/:id/credential",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId)) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const body = req.body as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || password.length < 6) {
      res.status(400).json({ error: "Enter a user ID and a password of at least 6 characters." });
      return;
    }
    const [branch] = await db
      .select()
      .from(branchesTable)
      .where(eq(branchesTable.id, branchId))
      .limit(1);
    if (!branch) {
      res.status(404).json({ error: "Branch not found." });
      return;
    }
    if (branch.username) {
      res.status(409).json({ error: "This branch already has a login — change its password instead." });
      return;
    }
    const [dup] = await db
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(eq(branchesTable.username, username))
      .limit(1);
    if (dup && dup.id !== branchId) {
      res.status(409).json({ error: "That user ID is already in use." });
      return;
    }
    const [updated] = await db
      .update(branchesTable)
      .set({ username, passwordHash: await hashPassword(password), plainPassword: password })
      .where(eq(branchesTable.id, branchId))
      .returning();
    res.status(201).json({ id: updated.id, username: updated.username, password });
  },
);

router.patch(
  "/admin/branches/:id/credential",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId)) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const body = req.body as { username?: unknown; password?: unknown };
    const updates: { username?: string; passwordHash?: string; plainPassword?: string } = {};
    if (typeof body.username === "string" && body.username.trim()) {
      const username = body.username.trim();
      const [dup] = await db
        .select({ id: branchesTable.id })
        .from(branchesTable)
        .where(eq(branchesTable.username, username))
        .limit(1);
      if (dup && dup.id !== branchId) {
        res.status(409).json({ error: "That user ID is already in use." });
        return;
      }
      updates.username = username;
    }
    if (typeof body.password === "string") {
      if (body.password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters." });
        return;
      }
      updates.passwordHash = await hashPassword(body.password);
      updates.plainPassword = body.password;
    }
    if (!updates.username && !updates.passwordHash) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    const [updated] = await db
      .update(branchesTable)
      .set(updates)
      .where(eq(branchesTable.id, branchId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Branch not found." });
      return;
    }
    if (!updated.passwordHash) {
      res.status(400).json({ error: "This branch has no login yet — create one first." });
      return;
    }
    res.json({ id: updated.id, username: updated.username, password: updated.plainPassword });
  },
);

// Branch desk APIs. A branch session is scoped to its own students and modules;
// students and attendance roll up across all of that branch's modules.
router.get(
  "/branch/students",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const students = await db
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.branchId, req.auth.branchId))
      .orderBy(asc(studentsTable.fullName));
    res.json(students.map(studentView));
  },
);

router.get(
  "/branch/overview",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const [branch] = await db
      .select()
      .from(branchesTable)
      .where(eq(branchesTable.id, req.auth.branchId))
      .limit(1);
    const modules = await db
      .select()
      .from(modulesCatalog)
      .where(eq(modulesCatalog.branchId, req.auth.branchId))
      .orderBy(asc(modulesCatalog.name));
    const studentRows = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(eq(studentsTable.branchId, req.auth.branchId));
    const totalStudents = studentRows.length;
    const perModule: { id: string; name: string; attendanceMarked: number; assessmentMarked: number }[] = [];
    const attendanceTouched = new Set<string>();
    const assessmentTouched = new Set<string>();
    for (const mod of modules) {
      const attenRows = await db
        .selectDistinct({ studentId: attendanceTable.studentId })
        .from(attendanceTable)
        .where(eq(attendanceTable.module, mod.id));
      const assessRows = await db
        .selectDistinct({ studentId: assessmentsTable.studentId })
        .from(assessmentsTable)
        .where(and(eq(assessmentsTable.module, mod.id), isNotNull(assessmentsTable.marks)));
      for (const row of attenRows) attendanceTouched.add(row.studentId);
      for (const row of assessRows) assessmentTouched.add(row.studentId);
      perModule.push({
        id: mod.id,
        name: mod.name,
        attendanceMarked: attenRows.length,
        assessmentMarked: assessRows.length,
      });
    }
    res.json({
      branchName: branch?.name ?? "Branch",
      totalStudents,
      attendanceMarked: attendanceTouched.size,
      attendancePending: Math.max(0, totalStudents - attendanceTouched.size),
      assessmentMarked: assessmentTouched.size,
      assessmentPending: Math.max(0, totalStudents - assessmentTouched.size),
      modules: perModule,
    });
  },
);

// A branch office enrols students exactly like the admin desk, only pinned to its own
// branch. The caller's branchId wins — anything sent in the body is ignored so a branch
// can never sign a student up under another branch.
router.post(
  "/branch/students",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const parsed = CreateStudentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please complete all student fields correctly." });
      return;
    }
    const data = parsed.data;
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
    const [student] = await db
      .insert(studentsTable)
      .values({
        id: nextStudentId(lastStudent?.id),
        fullName: data.fullName.trim(),
        fathersName: data.fathersName.trim(),
        course: data.course.trim(),
        dateOfJoining: data.dateOfJoining.toISOString().slice(0, 10),
        contactNumber: data.contactNumber.trim(),
        email,
        address: optionalText(data.address),
        guardianContact: optionalText(data.guardianContact),
        passwordHash: await hashPassword(data.password),
        plainPassword: data.password,
        branchId: req.auth.branchId,
      })
      .returning();
    res.status(201).json(CreateStudentResponse.parse(studentView(student)));
  },
);

// Branch twin of /admin/students/status: who in this branch is clear right now, read
// against only the modules that belong to this branch. Registered before :id routes.
router.get(
  "/branch/students/status",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    res.json(await buildStatus(await branchModuleIds(req.auth.branchId)));
  },
);

// The branch record screen mirrors the admin one, but every lookup is scoped to the
// branch so a branch can never read or touch a student enrolled under another one.
function rootBranchStudentId(req: { params: { id?: unknown } }): string {
  return String(req.params.id ?? "");
}

router.get(
  "/branch/students/:id",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .limit(1);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(GetStudentResponse.parse(studentView(student)));
  },
);

router.get(
  "/branch/students/:id/detail",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .limit(1);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

router.get(
  "/branch/students/:id/credential",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const [student] = await db
      .select({ id: studentsTable.id, plainPassword: studentsTable.plainPassword })
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .limit(1);
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json({ password: student.plainPassword });
  },
);

router.patch(
  "/branch/students/:id/photo",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const photo = req.body?.photo;
    if (photo !== null && typeof photo !== "string") {
      res.status(400).json({ error: "Send a photo data URL, or null to remove it." });
      return;
    }
    if (typeof photo === "string" && !/^data:image\/(png|jpeg|webp);base64,/.test(photo)) {
      res.status(400).json({ error: "Only PNG, JPEG or WebP images are accepted." });
      return;
    }
    if (typeof photo === "string" && photo.length > 1_500_000) {
      res.status(400).json({ error: "That image is too large." });
      return;
    }
    const [student] = await db
      .update(studentsTable)
      .set({ photo })
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

router.patch(
  "/branch/students/:id/remark",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const raw = req.body?.remark;
    if (raw !== null && typeof raw !== "string") {
      res.status(400).json({ error: "Send a remark, or null to clear it." });
      return;
    }
    const remark = typeof raw === "string" ? raw.trim().slice(0, 2000) : null;
    const [student] = await db
      .update(studentsTable)
      .set({ remark: remark === "" ? null : remark })
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

router.patch(
  "/branch/students/:id",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const parsed = UpdateStudentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please complete all student fields correctly." });
      return;
    }
    const data = parsed.data;
    const id = rootBranchStudentId(req);
    const email = normalizeEmail(data.email);
    const [clash] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(and(eq(studentsTable.email, email), ne(studentsTable.id, id)))
      .limit(1);
    if (clash) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const [student] = await db
      .update(studentsTable)
      .set({
        fullName: data.fullName.trim(),
        fathersName: data.fathersName.trim(),
        course: data.course.trim(),
        dateOfJoining: data.dateOfJoining.toISOString().slice(0, 10),
        contactNumber: data.contactNumber.trim(),
        email,
        address: optionalText(data.address),
        guardianContact: optionalText(data.guardianContact),
      })
      .where(
        and(
          eq(studentsTable.id, id),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(studentView(student));
  },
);

router.patch(
  "/branch/students/:id/password",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const parsed = UpdateStudentPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid new password." });
      return;
    }
    const [student] = await db
      .update(studentsTable)
      .set({
        passwordHash: await hashPassword(parsed.data.password),
        plainPassword: parsed.data.password,
      })
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .returning();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.delete(
  "/branch/students/:id",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const deleted = await db
      .delete(studentsTable)
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .returning({ id: studentsTable.id });
    if (!deleted[0]) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    await db
      .delete(sessionsTable)
      .where(
        and(eq(sessionsTable.userId, deleted[0].id), eq(sessionsTable.role, "student")),
      );
    res.sendStatus(204);
  },
);

router.get(
  "/branch/students/:id/report",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const [ownership] = await db
      .select({ branchId: studentsTable.branchId })
      .from(studentsTable)
      .where(
        and(
          eq(studentsTable.id, rootBranchStudentId(req)),
          eq(studentsTable.branchId, req.auth.branchId),
        ),
      )
      .limit(1);
    if (!ownership) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    res.json(await buildStudentReport(rootBranchStudentId(req)));
  },
);

// ---------------------------------------------------------------- announcements
// A module owner writes notices for students. Drafts stay on their own desk; only a
// published notice reaches the student portal, and unpublishing takes it back down.

function announcementView(record: typeof announcementsTable.$inferSelect) {
  return {
    id: record.id,
    module: record.module,
    title: record.title,
    body: record.body,
    authorName: record.authorName,
    published: record.publishedAt != null,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    image: record.image ?? null,
  };
}

// Announcements can carry one image (poster/notice). The client sends a data URL
// (img/photo's FileReader result) or null to clear it. A nil or empty string means
// "no image". Stored on the row, so keep it reasonably small — 2 MB of base64 max.
const MAX_IMAGE_BYTES = 2_800_000;
function normalizeImage(value: unknown): string | null | undefined {
  if (value === undefined) return undefined; // caller leaves the column alone
  if (value === null || value === '') return null; // clear it
  if (typeof value !== 'string') return undefined; // garbage: leave alone rather than clobber
  if (value.length > MAX_IMAGE_BYTES) return undefined;
  return value;
}

function announcementInput(body: unknown): { title: string; body: string; image?: string | null } | null {
  const raw = (body ?? {}) as { title?: unknown; body?: unknown; image?: unknown };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const text = typeof raw.body === "string" ? raw.body.trim() : "";
  const image = normalizeImage(raw.image);
  // Any one of the three is enough: a poster-only notice has no title or message.
  if (!title && !text && image == null) return null;
  if (title.length > 200 || text.length > 5000) return null;
  return { title, body: text, ...(image === undefined ? {} : { image }) };
}

// Everything this module has written, drafts included.
router.get(
  "/teacher/announcements",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const rows = await db
      .select()
      .from(announcementsTable)
      .where(eq(announcementsTable.module, req.auth.module))
      .orderBy(desc(announcementsTable.createdAt));
    res.json(rows.map(announcementView));
  },
);

router.post(
  "/teacher/announcements",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const input = announcementInput(req.body);
    if (!input) {
      res.status(400).json({ error: "Enter a title and a message." });
      return;
    }
    const publish = (req.body as { publish?: unknown })?.publish === true;
    const [record] = await db
      .insert(announcementsTable)
      .values({
        module: req.auth.module,
        title: input.title,
        body: input.body,
        authorName: req.auth.displayName ?? null,
        createdBy: Number(req.auth.userId),
        publishedAt: publish ? new Date() : null,
        image: input.image ?? null,
      })
      .returning();
    res.status(201).json(announcementView(record));
  },
);

// Edit the wording, or flip it between draft and published.
router.patch(
  "/teacher/announcements/:id",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid notice." });
      return;
    }
    const raw = (req.body ?? {}) as { publish?: unknown; title?: unknown; body?: unknown; image?: unknown };
    const patch: Partial<typeof announcementsTable.$inferInsert> = { updatedAt: new Date() };
    if (raw.title !== undefined || raw.body !== undefined) {
      const input = announcementInput(req.body);
      if (!input) {
        res.status(400).json({ error: "Enter a title and a message." });
        return;
      }
      patch.title = input.title;
      patch.body = input.body;
      if (input.image !== undefined) patch.image = input.image;
    }
    if (raw.image !== undefined && !(raw.title !== undefined || raw.body !== undefined)) {
      patch.image = normalizeImage(raw.image) ?? null;
    }
    if (typeof raw.publish === "boolean") {
      patch.publishedAt = raw.publish ? new Date() : null;
    }
    const [record] = await db
      .update(announcementsTable)
      .set(patch)
      .where(
        and(
          eq(announcementsTable.id, id),
          eq(announcementsTable.module, req.auth.module),
        ),
      )
      .returning();
    if (!record) {
      res.status(404).json({ error: "Notice not found." });
      return;
    }
    res.json(announcementView(record));
  },
);

router.delete(
  "/teacher/announcements/:id",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid notice." });
      return;
    }
    const [record] = await db
      .delete(announcementsTable)
      .where(
        and(
          eq(announcementsTable.id, id),
          eq(announcementsTable.module, req.auth.module),
        ),
      )
      .returning();
    if (!record) {
      res.status(404).json({ error: "Notice not found." });
      return;
    }
    res.status(204).end();
  },
);

// The admin desk sits above the modules: it reads every notice from every module,
// writes one into whichever module it picks, and can take down or delete anybody's.
// `createdBy` points at the teachers table, so an admin-written notice leaves it null
// and leans on `authorName` instead.

router.get(
  "/admin/announcements",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt));
    res.json(rows.map(announcementView));
  },
);

router.post(
  "/admin/announcements",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = (req.body as { module?: unknown })?.module as Module;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const input = announcementInput(req.body);
    if (!input) {
      res.status(400).json({ error: "Enter a title and a message." });
      return;
    }
    const publish = (req.body as { publish?: unknown })?.publish === true;
    const [record] = await db
      .insert(announcementsTable)
      .values({
        module,
        title: input.title,
        body: input.body,
        authorName: req.auth?.displayName ?? null,
        createdBy: null,
        publishedAt: publish ? new Date() : null,
        image: input.image ?? null,
      })
      .returning();
    res.status(201).json(announcementView(record));
  },
);

// Same edit/publish switch as the module desk, but without the module filter so the
// admin can moderate a notice a teacher wrote.
router.patch(
  "/admin/announcements/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid notice." });
      return;
    }
    const raw = (req.body ?? {}) as { publish?: unknown; title?: unknown; body?: unknown; image?: unknown };
    const patch: Partial<typeof announcementsTable.$inferInsert> = { updatedAt: new Date() };
    if (raw.title !== undefined || raw.body !== undefined) {
      const input = announcementInput(req.body);
      if (!input) {
        res.status(400).json({ error: "Enter a title and a message." });
        return;
      }
      patch.title = input.title;
      patch.body = input.body;
      if (input.image !== undefined) patch.image = input.image;
    }
    if (raw.image !== undefined && !(raw.title !== undefined || raw.body !== undefined)) {
      patch.image = normalizeImage(raw.image) ?? null;
    }
    if (typeof raw.publish === "boolean") {
      patch.publishedAt = raw.publish ? new Date() : null;
    }
    const [record] = await db
      .update(announcementsTable)
      .set(patch)
      .where(eq(announcementsTable.id, id))
      .returning();
    if (!record) {
      res.status(404).json({ error: "Notice not found." });
      return;
    }
    res.json(announcementView(record));
  },
);

router.delete(
  "/admin/announcements/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid notice." });
      return;
    }
    const [record] = await db
      .delete(announcementsTable)
      .where(eq(announcementsTable.id, id))
      .returning();
    if (!record) {
      res.status(404).json({ error: "Notice not found." });
      return;
    }
    res.status(204).end();
  },
);

// The branch desk moderates its own branch: it reads the notices of its own modules
// and writes one into whichever module it picks. Like the admin desk, an announcement
// written here leaves `createdBy` null (that column references teachers) and leans on
// `authorName` instead.

router.get(
  "/branch/announcements",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const moduleKeys = await branchModuleIds(req.auth.branchId);
    const rows = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt));
    res.json(rows.filter((row) => moduleKeys.includes(row.module)).map(announcementView));
  },
);

router.post(
  "/branch/announcements",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = (req.body as { module?: unknown })?.module as Module;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const input = announcementInput(req.body);
    if (!input) {
      res.status(400).json({ error: "Enter a title and a message." });
      return;
    }
    const publish = (req.body as { publish?: unknown })?.publish === true;
    const [record] = await db
      .insert(announcementsTable)
      .values({
        module,
        title: input.title,
        body: input.body,
        authorName: req.auth?.displayName ?? null,
        createdBy: null,
        publishedAt: publish ? new Date() : null,
        image: input.image ?? null,
      })
      .returning();
    res.status(201).json(announcementView(record));
  },
);

router.patch(
  "/branch/announcements/:id",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid notice." });
      return;
    }
    const moduleKeys = await branchModuleIds(req.auth.branchId);
    const rows = await db
      .select({ id: announcementsTable.id, module: announcementsTable.module })
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id))
      .limit(1);
    if (!rows[0] || !moduleKeys.includes(rows[0].module)) {
      res.status(404).json({ error: "Notice not found." });
      return;
    }
    const raw = (req.body ?? {}) as { publish?: unknown; title?: unknown; body?: unknown; image?: unknown };
    const patch: Partial<typeof announcementsTable.$inferInsert> = { updatedAt: new Date() };
    if (raw.title !== undefined || raw.body !== undefined) {
      const input = announcementInput(req.body);
      if (!input) {
        res.status(400).json({ error: "Enter a title and a message." });
        return;
      }
      patch.title = input.title;
      patch.body = input.body;
      if (input.image !== undefined) patch.image = input.image;
    }
    if (raw.image !== undefined && !(raw.title !== undefined || raw.body !== undefined)) {
      patch.image = normalizeImage(raw.image) ?? null;
    }
    if (typeof raw.publish === "boolean") {
      patch.publishedAt = raw.publish ? new Date() : null;
    }
    const [record] = await db
      .update(announcementsTable)
      .set(patch)
      .where(eq(announcementsTable.id, id))
      .returning();
    if (!record) {
      res.status(404).json({ error: "Notice not found." });
      return;
    }
    res.json(announcementView(record));
  },
);

router.delete(
  "/branch/announcements/:id",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid notice." });
      return;
    }
    const moduleKeys = await branchModuleIds(req.auth.branchId);
    const rows = await db
      .select({ id: announcementsTable.id, module: announcementsTable.module })
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id))
      .limit(1);
    if (!rows[0] || !moduleKeys.includes(rows[0].module)) {
      res.status(404).json({ error: "Notice not found." });
      return;
    }
    await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
    res.status(204).end();
  },
);

  // Students read published notices for the modules inside THEIR branch only.
  router.get(
  "/student/announcements",
  requireRole("student"),
  async (req, res): Promise<void> => {
    if (!req.auth?.studentId) {
      res.status(401).json({ error: "Student session not found." });
      return;
    }
    const moduleKeys = await studentModuleKeys(req.auth.studentId);
    const rows = await db
      .select()
      .from(announcementsTable)
      .where(isNotNull(announcementsTable.publishedAt))
      .orderBy(desc(announcementsTable.publishedAt));
    res.json(rows.filter((row) => moduleKeys.includes(row.module)).map(announcementView));
  },
);

// ------------------------------------------------------------ course documents
// The syllabus / project plan / project guidelines PDFs students read. One current
// file per (module, kind): an upload overwrites the row, so replacing a syllabus
// deletes the old one in the same statement and students never see two versions.
//
// Staff manage these; every signed-in role may download one. Teachers are pinned to
// their own module exactly like every other teacher route.

const documentKinds = ["syllabus", "project_plan", "project_guidelines"] as const;
type DocumentKind = (typeof documentKinds)[number];

// 8 MB of actual PDF. express.json is raised to 12mb to leave room for base64's ~33%
// overhead plus the rest of the envelope.
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

function documentView(record: typeof courseDocumentsTable.$inferSelect) {
  return {
    module: record.module,
    kind: record.kind,
    fileName: record.fileName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    uploadedByName: record.uploadedByName,
    updatedAt: record.updatedAt.toISOString(),
  };
}

// Accepts either a bare base64 string or a data URL, since the browser's FileReader
// hands back the latter.
function parseDocumentUpload(
  body: unknown,
): { fileName: string; content: string; sizeBytes: number } | { error: string } {
  const raw = (body ?? {}) as { fileName?: unknown; content?: unknown };
  const fileName = typeof raw.fileName === "string" ? raw.fileName.trim() : "";
  const rawContent = typeof raw.content === "string" ? raw.content : "";
  if (!fileName || !rawContent) return { error: "Choose a PDF to upload." };
  if (fileName.length > 200) return { error: "That file name is too long." };
  if (!/\.pdf$/i.test(fileName)) return { error: "Only PDF files can be uploaded." };

  const match = /^data:([^;,]*);base64,(.*)$/s.exec(rawContent);
  const declaredType = match ? match[1] : "application/pdf";
  const base64 = (match ? match[2] : rawContent).replace(/\s/g, "");
  if (match && declaredType && declaredType !== "application/pdf") {
    return { error: "Only PDF files can be uploaded." };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { error: "That file could not be read. Try again." };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { error: "That file could not be read. Try again." };
  }
  if (buffer.length === 0) return { error: "That file is empty." };
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return { error: "That PDF is larger than 8 MB. Please upload a smaller file." };
  }
  // Trust the bytes, not the extension: a renamed .docx would sail past the name check.
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { error: "That file is not a valid PDF." };
  }
  return { fileName, content: base64, sizeBytes: buffer.length };
}

async function saveDocument(
  module: Module,
  kind: DocumentKind,
  upload: { fileName: string; content: string; sizeBytes: number },
  uploadedByName: string | null,
) {
  const [record] = await db
    .insert(courseDocumentsTable)
    .values({
      module,
      kind,
      fileName: upload.fileName,
      contentType: "application/pdf",
      sizeBytes: upload.sizeBytes,
      content: upload.content,
      uploadedByName,
    })
    .onConflictDoUpdate({
      target: [courseDocumentsTable.module, courseDocumentsTable.kind],
      set: {
        fileName: upload.fileName,
        contentType: "application/pdf",
        sizeBytes: upload.sizeBytes,
        content: upload.content,
        uploadedByName,
        updatedAt: new Date(),
      },
    })
    .returning();
  return record;
}

// Metadata only — the bytes would bloat every list response. Admin sees every module;
// a student only sees the modules inside their branch.
router.get(
  ["/admin/documents", "/student/documents"],
  requireRole("admin", "student"),
  async (req, res): Promise<void> => {
    const rows = await db
      .select({
        module: courseDocumentsTable.module,
        kind: courseDocumentsTable.kind,
        fileName: courseDocumentsTable.fileName,
        contentType: courseDocumentsTable.contentType,
        sizeBytes: courseDocumentsTable.sizeBytes,
        uploadedByName: courseDocumentsTable.uploadedByName,
        updatedAt: courseDocumentsTable.updatedAt,
      })
      .from(courseDocumentsTable);
    if (req.auth?.role === "student" && req.auth.studentId) {
      const moduleKeys = await studentModuleKeys(req.auth.studentId);
      res.json(rows.filter((row) => moduleKeys.includes(row.module)).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })));
      return;
    }
    res.json(rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })));
  },
);

router.get(
  "/teacher/documents",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const rows = await db
      .select({
        module: courseDocumentsTable.module,
        kind: courseDocumentsTable.kind,
        fileName: courseDocumentsTable.fileName,
        contentType: courseDocumentsTable.contentType,
        sizeBytes: courseDocumentsTable.sizeBytes,
        uploadedByName: courseDocumentsTable.uploadedByName,
        updatedAt: courseDocumentsTable.updatedAt,
      })
      .from(courseDocumentsTable)
      .where(eq(courseDocumentsTable.module, req.auth.module));
    res.json(rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })));
  },
);

// A branch office manages its own modules' files — only the PDFs under its modules.
router.get(
  "/branch/documents",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const moduleKeys = await branchModuleIds(req.auth.branchId);
    const rows = await db
      .select({
        module: courseDocumentsTable.module,
        kind: courseDocumentsTable.kind,
        fileName: courseDocumentsTable.fileName,
        contentType: courseDocumentsTable.contentType,
        sizeBytes: courseDocumentsTable.sizeBytes,
        uploadedByName: courseDocumentsTable.uploadedByName,
        updatedAt: courseDocumentsTable.updatedAt,
      })
      .from(courseDocumentsTable);
    res.json(rows.filter((row) => moduleKeys.includes(row.module)).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })));
  },
);

// The download. Inline so the browser's PDF viewer opens it instead of saving it.
// Every signed-in role may read any module's file — students take all three modules.
router.get(
  [
    "/admin/documents/:module/:kind/file",
    "/teacher/documents/:module/:kind/file",
    "/student/documents/:module/:kind/file",
    "/branch/documents/:module/:kind/file",
  ],
  requireRole("admin", "teacher", "student", "branch"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    const kind = req.params.kind as DocumentKind;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    if (req.auth?.role === "branch") {
      if (req.auth.branchId == null) {
        res.status(400).json({ error: "Choose a branch." });
        return;
      }
      if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
        res.status(404).json({ error: "That file has not been uploaded yet." });
        return;
      }
    }
    if (!(documentKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Invalid document." });
      return;
    }
    const [record] = await db
      .select()
      .from(courseDocumentsTable)
      .where(
        and(
          eq(courseDocumentsTable.module, module),
          eq(courseDocumentsTable.kind, kind),
        ),
      )
      .limit(1);
    if (!record) {
      res.status(404).json({ error: "That file has not been uploaded yet." });
      return;
    }
    const buffer = Buffer.from(record.content, "base64");
    res.setHeader("Content-Type", record.contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${record.fileName.replace(/["\\]/g, "")}"`,
    );
    // Staff replace these in place, so a cached copy would hide the new upload.
    res.setHeader("Cache-Control", "no-store");
    res.end(buffer);
  },
);

router.post(
  "/admin/documents",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = (req.body as { module?: unknown })?.module as Module;
    const kind = (req.body as { kind?: unknown })?.kind as DocumentKind;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    if (!(documentKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Choose a valid document." });
      return;
    }
    const upload = parseDocumentUpload(req.body);
    if ("error" in upload) {
      res.status(400).json({ error: upload.error });
      return;
    }
    const record = await saveDocument(
      module,
      kind,
      upload,
      req.auth?.displayName ?? null,
    );
    res.status(201).json(documentView(record));
  },
);

router.post(
  "/teacher/documents",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const kind = (req.body as { kind?: unknown })?.kind as DocumentKind;
    if (!(documentKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Choose a valid document." });
      return;
    }
    const upload = parseDocumentUpload(req.body);
    if ("error" in upload) {
      res.status(400).json({ error: upload.error });
      return;
    }
    const record = await saveDocument(
      req.auth.module,
      kind,
      upload,
      req.auth.displayName ?? null,
    );
    res.status(201).json(documentView(record));
  },
);

// The branch upload takes the target module in the body (it may own several), checked
// against THIS branch's catalog before anything is saved.
router.post(
  "/branch/documents",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = (req.body as { module?: unknown })?.module as Module;
    const kind = (req.body as { kind?: unknown })?.kind as DocumentKind;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    if (!(documentKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Choose a valid document." });
      return;
    }
    const upload = parseDocumentUpload(req.body);
    if ("error" in upload) {
      res.status(400).json({ error: upload.error });
      return;
    }
    const record = await saveDocument(
      module,
      kind,
      upload,
      req.auth?.displayName ?? null,
    );
    res.status(201).json(documentView(record));
  },
);

router.delete(
  "/admin/documents/:module/:kind",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    const kind = req.params.kind as DocumentKind;
    if (!(await isValidModule(module))) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    if (!(documentKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Invalid document." });
      return;
    }
    const [record] = await db
      .delete(courseDocumentsTable)
      .where(
        and(
          eq(courseDocumentsTable.module, module),
          eq(courseDocumentsTable.kind, kind),
        ),
      )
      .returning();
    if (!record) {
      res.status(404).json({ error: "That file has not been uploaded yet." });
      return;
    }
    res.status(204).end();
  },
);

router.delete(
  "/teacher/documents/:kind",
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    if (!req.auth?.module) {
      res.status(400).json({ error: "Choose a valid module." });
      return;
    }
    const kind = req.params.kind as DocumentKind;
    if (!(documentKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Invalid document." });
      return;
    }
    const [record] = await db
      .delete(courseDocumentsTable)
      .where(
        and(
          eq(courseDocumentsTable.module, req.auth.module),
          eq(courseDocumentsTable.kind, kind),
        ),
      )
      .returning();
    if (!record) {
      res.status(404).json({ error: "That file has not been uploaded yet." });
      return;
    }
    res.status(204).end();
  },
);

// Branch files are removed by (module, kind); the module must belong to this branch.
router.delete(
  "/branch/documents/:module/:kind",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = req.params.module as Module;
    const kind = req.params.kind as DocumentKind;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    if (!(documentKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Invalid document." });
      return;
    }
    const [record] = await db
      .delete(courseDocumentsTable)
      .where(
        and(
          eq(courseDocumentsTable.module, module),
          eq(courseDocumentsTable.kind, kind),
        ),
      )
      .returning();
    if (!record) {
      res.status(404).json({ error: "That file has not been uploaded yet." });
      return;
    }
    res.status(204).end();
  },
);

// Branch module attendance summary — mirrors admin but scoped to the session's branch.
router.get(
  "/branch/modules/:module/attendance/summary",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = req.params.module as Module;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const rawMonth = typeof req.query.month === "string" ? req.query.month : "";
    const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : isoDay(new Date()).slice(0, 7);

    const branchStudents = await db
      .select({ id: studentsTable.id, dateOfJoining: studentsTable.dateOfJoining })
      .from(studentsTable)
      .where(eq(studentsTable.branchId, req.auth.branchId));
    const studentIds = branchStudents.map((s) => s.id);

    const attendanceRows = await db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.module, module), inArray(attendanceTable.studentId, studentIds)));
    const byStudent = new Map<string, (typeof attendanceTable.$inferSelect)[]>();
    for (const row of attendanceRows) {
      byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row]);
    }
    const assessments = await db
      .select()
      .from(assessmentsTable)
      .where(and(eq(assessmentsTable.module, module), inArray(assessmentsTable.studentId, studentIds)));

    const events = await eventDates();

    const monthKeys = new Set<string>();
    for (const student of branchStudents) {
      for (const slice of courseMonths(student.dateOfJoining, events)) {
        if (slice.start) monthKeys.add(slice.start.slice(0, 7));
      }
    }
    const months = [...monthKeys].sort();
    const currentKey = isoDay(new Date()).slice(0, 7);
    if (months.length > 0 && currentKey >= months[0] && currentKey <= months[months.length - 1]) {
      monthKeys.add(currentKey);
    }
    const orderedMonths = [...monthKeys].sort();

    let studentsMarked = 0;
    let presentDays = 0;
    let possibleDays = 0;
    let projectOneMarked = 0;
    let projectTwoMarked = 0;
    for (const student of branchStudents) {
      const slice = courseMonths(student.dateOfJoining, events).find(
        (s) => s.start && s.start.slice(0, 7) === monthKey,
      );
      if (!slice) continue;
      possibleDays += slice.days.length;

      const presentOn = presentDatesByModule(
        student.dateOfJoining,
        byStudent.get(student.id) ?? [],
      );
      const present = slice.days.filter((day) => presentOn.get(day)?.has(module)).length;
      presentDays += present;
      if (present > 0) studentsMarked += 1;

      const cycle1 = (slice.month - 1) * 2 + 1;
      const cycle2 = (slice.month - 1) * 2 + 2;
      const own = assessments.filter((a) => a.studentId === student.id);
      if (own.find((a) => a.cycle === cycle1 && a.marks != null)) projectOneMarked += 1;
      if (own.find((a) => a.cycle === cycle2 && a.marks != null)) projectTwoMarked += 1;
    }

    const totalStudents = branchStudents.reduce(
      (sum, student) =>
        sum +
        (courseMonths(student.dateOfJoining, events).some(
          (s) => s.start && s.start.slice(0, 7) === monthKey,
        )
          ? 1
          : 0),
      0,
    );

    res.json({
      month: monthKey,
      months: orderedMonths,
      totalStudents,
      studentsMarked,
      studentsPending: Math.max(0, totalStudents - studentsMarked),
      marked: presentDays,
      expected: possibleDays,
      pending: Math.max(0, possibleDays - presentDays),
      assessmentMarked: projectOneMarked + projectTwoMarked,
      projects: [
        { project: 1, marked: projectOneMarked },
        { project: 2, marked: projectTwoMarked },
      ],
    });
  },
);

// Branch teachers for a specific module — scoped to the session's branch.
router.get(
  "/branch/modules/:module/teachers",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = req.params.module as Module;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const teachers = await db
      .select({
        id: teachersTable.id,
        username: teachersTable.username,
        module: teachersTable.module,
        displayName: teachersTable.displayName,
        plainPassword: teachersTable.plainPassword,
      })
      .from(teachersTable)
      .where(eq(teachersTable.module, module))
      .orderBy(asc(teachersTable.displayName));
    res.json(teachers);
  },
);

// Branch teacher CRUD for a specific module — scoped to the session's branch.
router.post(
  "/branch/modules/:module/teachers",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = req.params.module as Module;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const bodyWithModule = { ...req.body, module: req.params.module };
    const parsed = CreateTeacherBody.safeParse(bodyWithModule);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter valid teacher details." });
      return;
    }
    const { username, password, displayName } = parsed.data;
    const [dup] = await db
      .select({ id: teachersTable.id })
      .from(teachersTable)
      .where(eq(teachersTable.username, username))
      .limit(1);
    if (dup) {
      res.status(409).json({ error: "That user ID is already in use." });
      return;
    }
    const [teacher] = await db
      .insert(teachersTable)
      .values({
        username,
        module,
        displayName,
        passwordHash: await hashPassword(password),
        plainPassword: password,
      })
      .returning();
    res.status(201).json({
      id: teacher.id,
      username: teacher.username,
      module: teacher.module,
      displayName: teacher.displayName,
      plainPassword: teacher.plainPassword,
    });
  },
);

router.patch(
  "/branch/modules/:module/teachers/:id",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = req.params.module as Module;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const teacherId = Number(req.params.id);
    if (!Number.isInteger(teacherId)) {
      res.status(400).json({ error: "Choose a teacher." });
      return;
    }
    const body = req.body as { password?: unknown; displayName?: unknown; username?: unknown };
    const updates: { passwordHash?: string; plainPassword?: string; displayName?: string; username?: string } = {};
    if (typeof body.password === "string" && body.password.length >= 6) {
      updates.passwordHash = await hashPassword(body.password);
      updates.plainPassword = body.password;
    }
    if (typeof body.displayName === "string" && body.displayName.trim()) {
      updates.displayName = body.displayName.trim();
    }
    if (typeof body.username === "string" && body.username.trim()) {
      const username = body.username.trim();
      const [dup] = await db
        .select({ id: teachersTable.id })
        .from(teachersTable)
        .where(and(eq(teachersTable.username, username), ne(teachersTable.id, teacherId)))
        .limit(1);
      if (dup) {
        res.status(409).json({ error: "That user ID is already in use." });
        return;
      }
      updates.username = username;
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    const [teacher] = await db
      .update(teachersTable)
      .set(updates)
      .where(and(eq(teachersTable.id, teacherId), eq(teachersTable.module, req.params.module as Module)))
      .returning();
    if (!teacher) {
      res.status(404).json({ error: "Teacher not found." });
      return;
    }
    res.json({
      id: teacher.id,
      username: teacher.username,
      module: teacher.module,
      displayName: teacher.displayName,
      plainPassword: teacher.plainPassword ?? null,
    });
  },
);

router.delete(
  "/branch/modules/:module/teachers/:id",
  requireRole("branch"),
  async (req, res): Promise<void> => {
    if (req.auth?.branchId == null) {
      res.status(400).json({ error: "Choose a branch." });
      return;
    }
    const module = req.params.module as Module;
    if (!(await branchModuleIds(req.auth.branchId)).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const teacherId = Number(req.params.id);
    if (!Number.isInteger(teacherId)) {
      res.status(400).json({ error: "Choose a teacher." });
      return;
    }
    const [deleted] = await db
      .delete(teachersTable)
      .where(and(eq(teachersTable.id, teacherId), eq(teachersTable.module, module)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Teacher not found." });
      return;
    }
    res.status(204).end();
  },
);

export default router;

