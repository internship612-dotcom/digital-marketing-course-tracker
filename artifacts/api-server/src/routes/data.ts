import { Router, type IRouter } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
} from "drizzle-orm";
import {
  assessmentsTable,
  attendanceTable,
  db,
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
  requireRole,
} from "../lib/auth";

const router: IRouter = Router();
const DEFAULT_WEEKS = 12;
const DEFAULT_CYCLES = 6;
const modules = ["ai", "dm", "sm"] as const;
type Module = (typeof modules)[number];

function moduleLabel(module: Module): string {
  return module === "ai"
    ? "AI in Marketing"
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
  };
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
    try {
      const [teacher] = await db
        .insert(teachersTable)
        .values({
          username: parsed.data.username.trim(),
          passwordHash: await hashPassword(parsed.data.password),
          module: parsed.data.module,
          displayName: parsed.data.displayName.trim(),
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
          }),
        );
    } catch {
      res.status(400).json({ error: "That username is already in use." });
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
        }),
      );
    } catch {
      res.status(400).json({ error: "That username is already in use." });
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

export default router;