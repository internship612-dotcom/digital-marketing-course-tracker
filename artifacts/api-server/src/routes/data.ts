import { Router, type IRouter } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  max,
  ne,
  or,
} from "drizzle-orm";
import {
  announcementsTable,
  assessmentsTable,
  attendanceTable,
  courseDocumentsTable,
  db,
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
const modules = ["ai", "dm", "sm"] as const;
type Module = (typeof modules)[number];

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
    res.json(await buildStatus(modules));
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
// column), so this mirrors POST /admin/students exactly — same validation, same ids.
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
    if (!(modules as readonly string[]).includes(module)) {
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

// Every attendance figure in the app is counted the same way: the course runs six
// months from the admission date, and each month runs from one admission anniversary
// to the day before the next. A student admitted on the 4th has months that run 4th
// to 3rd, so there are always exactly six of them and none is a stub.
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

// The six admission-to-admission slices of one student's course. Month N starts on
// the admission day-of-month N-1 months on, and ends the day before month N+1 starts,
// so the six slices are contiguous and cover exactly six months.
function courseMonths(joinedOn: string | null): CourseMonth[] {
  if (!joinedOn) return [];
  const joinDate = new Date(`${joinedOn}T00:00:00Z`);
  if (Number.isNaN(joinDate.getTime())) return [];
  const year = joinDate.getUTCFullYear();
  const month0 = joinDate.getUTCMonth();
  const day = joinDate.getUTCDate();

  const slices: CourseMonth[] = [];
  for (let month = 1; month <= COURSE_MONTHS; month += 1) {
    const start = utcDay(year, month0 + month - 1, day);
    const end = utcDay(year, month0 + month, day - 1);
    const days: string[] = [];
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 0) continue; // Sunday is off
      days.push(isoDay(d));
    }
    slices.push({ month, start: isoDay(start), end: isoDay(end), days });
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
  const slices = courseMonths(joinedOn);
  const presentOn = presentDatesByModule(joinedOn, attendanceRows);

  const months = slices.map((slice) => {
    const total = slice.days.length;
    const perModule = modules.map((module) => {
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
    if (!(modules as readonly string[]).includes(module)) {
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
    if (!(modules as readonly string[]).includes(module)) {
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
    if (!(modules as readonly string[]).includes(module)) {
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

// Month N means "month N of that student's own course", so every student is counted
// against their own admission-anchored calendar month — the same slices the student
// and the module owner see on the record screen.
router.get(
  "/admin/modules/:module/attendance/summary",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(modules as readonly string[]).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
    }
    const rawMonth = Number(req.query.month ?? 1);
    const month = Number.isInteger(rawMonth) && rawMonth >= 1 ? rawMonth : 1;

    const students = await db
      .select({ id: studentsTable.id, dateOfJoining: studentsTable.dateOfJoining })
      .from(studentsTable);
    const attendanceRows = await db
      .select()
      .from(attendanceTable)
      .where(eq(attendanceTable.module, module));
    const byStudent = new Map<string, (typeof attendanceTable.$inferSelect)[]>();
    for (const row of attendanceRows) {
      byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row]);
    }

    let studentsMarked = 0;
    let presentDays = 0;
    let possibleDays = 0;
    for (const student of students) {
      const slice = courseMonths(student.dateOfJoining).find((s) => s.month === month);
      if (!slice) continue;
      possibleDays += slice.days.length;
      const presentOn = presentDatesByModule(
        student.dateOfJoining,
        byStudent.get(student.id) ?? [],
      );
      const present = slice.days.filter((day) => presentOn.get(day)?.has(module)).length;
      presentDays += present;
      if (present > 0) studentsMarked += 1;
    }

    const totalStudents = students.length;
    const cycles = [1, 2].map((i) => (month - 1) * 2 + i);
    const projects = await Promise.all(
      cycles.map(async (cycle) => {
        const [row] = await db
          .select({ value: count() })
          .from(assessmentsTable)
          .where(
            and(
              eq(assessmentsTable.module, module),
              eq(assessmentsTable.cycle, cycle),
              isNotNull(assessmentsTable.marks),
            ),
          );
        return { cycle, marked: Number(row.value) };
      }),
    );

    res.json({
      totalStudents,
      studentsMarked,
      studentsPending: Math.max(0, totalStudents - studentsMarked),
      marked: presentDays,
      expected: possibleDays,
      pending: Math.max(0, possibleDays - presentDays),
      assessmentMarked: projects.reduce((sum, project) => sum + project.marked, 0),
      projects,
    });
  },
);

router.get(
  "/admin/modules/:module/activity",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    if (!(modules as readonly string[]).includes(module)) {
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
    if (!(modules as readonly string[]).includes(module)) {
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
    if (!(modules as readonly string[]).includes(module)) {
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
    const summary = modules.map((module) => {
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
      modules.map((module) => [
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
): number {
  const date = new Date(`${today}T00:00:00Z`);
  if ((date.getUTCDay() + 6) % 7 > 5) return 0; // Sunday
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
): number {
  let pending = 0;
  for (const slice of courseMonths(joinedOn)) {
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
      );
      marksPending += marksPendingFor(student.dateOfJoining, ownAssessments, module, today);
    }
    payload.pendingAttendance[student.id] = attendancePending;
    payload.pendingMarks[student.id] = marksPending;
    if (attendancePending === 0) payload.attendance.push(student.id);
    if (marksPending === 0) payload.assessment.push(student.id);
  }
  return payload;
}

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
          recorded: Boolean(row),
          // Saved once, and closed from then on.
          locked: slot ? isLocked(row?.lockedDays, slot.day) : false,
        };
      }),
    );
  },
);

// Ticked students become present, the rest of the submitted list becomes absent, and
// anyone left out of both arrays keeps whatever they already had.
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
    };
    const date = parseDayParam(body.date);
    const present = Array.isArray(body.present)
      ? body.present.filter((id): id is string => typeof id === "string")
      : [];
    const absent = Array.isArray(body.absent)
      ? body.absent.filter((id): id is string => typeof id === "string")
      : [];
    if (!date || present.length + absent.length === 0) {
      res.status(400).json({ error: "Choose a date and at least one student." });
      return;
    }

    const touched = [...new Set([...present, ...absent])];
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
    let saved = 0;
    let skipped = 0;
    let locked = 0;
    for (const student of students) {
      const slot = weekAndDayFor(student.dateOfJoining, date);
      if (!slot) {
        skipped += 1;
        continue;
      }
      const row = existing.find(
        (r) => r.studentId === student.id && r.week === slot.week,
      );
      // A day that has already been saved stays as it was — attendance is final.
      if (isLocked(row?.lockedDays, slot.day)) {
        locked += 1;
        continue;
      }
      // Only this one day moves; the rest of the week keeps whatever it held.
      const flags = Object.fromEntries(
        DAY_FLAG_ORDER.map((key) => [key, row ? Boolean(row[key]) : false]),
      ) as Record<(typeof DAY_FLAG_ORDER)[number], boolean>;
      flags[slot.day] = presentSet.has(student.id);
      const lockedDays = (row?.lockedDays ?? 0) | dayBit(slot.day);
      await db
        .insert(attendanceTable)
        .values({
          studentId: student.id,
          module: req.auth.module,
          week: slot.week,
          status: "present",
          ...flags,
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
            lockedDays,
            recordedBy: Number(req.auth.userId),
            recordedAt: new Date(),
          },
        });
      saved += 1;
    }
    res.json({ saved, skipped, locked });
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
  };
}

function announcementInput(body: unknown): { title: string; body: string } | null {
  const raw = (body ?? {}) as { title?: unknown; body?: unknown };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const text = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!title || !text) return null;
  if (title.length > 200 || text.length > 5000) return null;
  return { title, body: text };
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
    const raw = (req.body ?? {}) as { publish?: unknown; title?: unknown; body?: unknown };
    const patch: Partial<typeof announcementsTable.$inferInsert> = { updatedAt: new Date() };
    if (raw.title !== undefined || raw.body !== undefined) {
      const input = announcementInput(req.body);
      if (!input) {
        res.status(400).json({ error: "Enter a title and a message." });
        return;
      }
      patch.title = input.title;
      patch.body = input.body;
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
    if (!(modules as readonly string[]).includes(module)) {
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
    const raw = (req.body ?? {}) as { publish?: unknown; title?: unknown; body?: unknown };
    const patch: Partial<typeof announcementsTable.$inferInsert> = { updatedAt: new Date() };
    if (raw.title !== undefined || raw.body !== undefined) {
      const input = announcementInput(req.body);
      if (!input) {
        res.status(400).json({ error: "Enter a title and a message." });
        return;
      }
      patch.title = input.title;
      patch.body = input.body;
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

// Students read every published notice, from all three modules, newest first.
router.get(
  "/student/announcements",
  requireRole("student"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(announcementsTable)
      .where(isNotNull(announcementsTable.publishedAt))
      .orderBy(desc(announcementsTable.publishedAt));
    res.json(rows.map(announcementView));
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

// Metadata only — the bytes would bloat every list response.
router.get(
  ["/admin/documents", "/student/documents"],
  requireRole("admin", "student"),
  async (_req, res): Promise<void> => {
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

// The download. Inline so the browser's PDF viewer opens it instead of saving it.
// Every signed-in role may read any module's file — students take all three modules.
router.get(
  [
    "/admin/documents/:module/:kind/file",
    "/teacher/documents/:module/:kind/file",
    "/student/documents/:module/:kind/file",
  ],
  requireRole("admin", "teacher", "student"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    const kind = req.params.kind as DocumentKind;
    if (!(modules as readonly string[]).includes(module)) {
      res.status(400).json({ error: "Invalid module." });
      return;
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
    if (!(modules as readonly string[]).includes(module)) {
      res.status(400).json({ error: "Choose a valid module." });
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

router.delete(
  "/admin/documents/:module/:kind",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const module = req.params.module as Module;
    const kind = req.params.kind as DocumentKind;
    if (!(modules as readonly string[]).includes(module)) {
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


export default router;

