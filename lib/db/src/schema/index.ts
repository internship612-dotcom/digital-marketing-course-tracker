import {
  date,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";

export const moduleEnum = pgEnum("module", ["ai", "dm", "sm"]);
export const roleEnum = pgEnum("role", ["admin", "teacher", "student"]);
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
]);

export const adminsTable = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teachersTable = pgTable(
  "teachers",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    module: moduleEnum("module").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    oneTeacherPerModule: unique("teachers_module_unique").on(table.module),
  }),
);

export const studentsTable = pgTable("students", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  fathersName: text("fathers_name").notNull(),
  course: text("course").notNull(),
  dateOfJoining: date("date_of_joining").notNull(),
  contactNumber: text("contact_number").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  registrationDate: timestamp("registration_date", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const attendanceTable = pgTable(
  "attendance",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    module: moduleEnum("module").notNull(),
    week: integer("week").notNull(),
    status: attendanceStatusEnum("status").notNull(),
    recordedBy: integer("recorded_by").references(() => teachersTable.id, {
      onDelete: "set null",
    }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.studentId, table.module, table.week] }),
  }),
);

export const assessmentsTable = pgTable(
  "assessments",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    module: moduleEnum("module").notNull(),
    cycle: integer("cycle").notNull(),
    marks: integer("marks"),
    feedback: text("feedback"),
    enteredAt: timestamp("entered_at", { withTimezone: true }),
    enteredBy: integer("entered_by").references(() => teachersTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.studentId, table.module, table.cycle] }),
  }),
);

export const sessionsTable = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    role: roleEnum("role").notNull(),
    userId: text("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export type Module = "ai" | "dm" | "sm";
export type Role = "admin" | "teacher" | "student";