import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

export const moduleEnum = pgEnum("module", ["ai", "dm", "sm"]);
export const roleEnum = pgEnum("role", ["admin", "teacher", "student"]);
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
]);
export const documentKindEnum = pgEnum("document_kind", [
  "syllabus",
  "project_plan",
  "project_guidelines",
]);

export const adminsTable = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull().default("Administrator"),
  module: moduleEnum("module").notNull().default("ai").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// A module can hold several teacher logins. Usernames stay unique; `module` is
// deliberately NOT unique, so the admin can add or remove staff per module.
export const teachersTable = pgTable("teachers", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  module: moduleEnum("module").notNull(),
  displayName: text("display_name").notNull(),
  plainPassword: text("plain_password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const studentsTable = pgTable("students", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  fathersName: text("fathers_name").notNull(),
  course: text("course").notNull(),
  dateOfJoining: date("date_of_joining").notNull(),
  contactNumber: text("contact_number").notNull(),
  // Optional on purpose: existing records predate both fields.
  address: text("address"),
  guardianContact: text("guardian_contact"),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Stored so the admin/module owner can reveal it, exactly like teachers.plain_password.
  plainPassword: text("plain_password"),
  // Data URL of a small square JPEG, resized in the browser before upload.
  photo: text("photo"),
  // Free-text note the admin or module owner keeps against the student.
  remark: text("remark"),
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
    mon: boolean("mon").notNull().default(false),
    tue: boolean("tue").notNull().default(false),
    wed: boolean("wed").notNull().default(false),
    thu: boolean("thu").notNull().default(false),
    fri: boolean("fri").notNull().default(false),
    sat: boolean("sat").notNull().default(false),
    // Which of mon..sat have been saved and are therefore closed to further edits.
    // Bit 0 = mon … bit 5 = sat. A recorded absent and a day nobody touched both
    // leave the day flag false, so this is what tells them apart.
    lockedDays: integer("locked_days").notNull().default(0),
    recordedBy: integer("recorded_by").references(() => teachersTable.id, {
      onDelete: "set null",
    }),
    recordedByAdmin: integer("recorded_by_admin").references(() => adminsTable.id, {
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
    // Typed by the module owner when uploading marks, e.g. "Landing page audit".
    projectName: text("project_name"),
    enteredAt: timestamp("entered_at", { withTimezone: true }),
    enteredBy: integer("entered_by").references(() => teachersTable.id, {
      onDelete: "set null",
    }),
    enteredByAdmin: integer("entered_by_admin").references(() => adminsTable.id, {
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

// Notices a module owner writes for students. A draft is invisible to students until
// publishedAt is set; unpublishing clears it again. authorName is kept alongside the
// teacher reference so a notice still reads correctly after that login is removed.
export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  module: moduleEnum("module").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorName: text("author_name"),
  createdBy: integer("created_by").references(() => teachersTable.id, {
    onDelete: "set null",
  }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// The course PDFs students read: one current file per (module, kind), which is what
// makes the composite primary key the whole replace story — uploading a new syllabus
// overwrites the row, so the old file is gone the moment the new one lands and there
// is never a second "current" file to choose between.
//
// The bytes live here rather than on disk because the app deploys to an autoscale
// target: that filesystem is ephemeral and not shared between instances, so an
// uploaded file would vanish on the next redeploy. Stored base64 (like students.photo)
// rather than bytea to keep the JSON round-trip simple.
export const courseDocumentsTable = pgTable(
  "course_documents",
  {
    module: moduleEnum("module").notNull(),
    kind: documentKindEnum("kind").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: text("content").notNull(),
    uploadedByName: text("uploaded_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.module, table.kind] }),
  }),
);

export type Module = "ai" | "dm" | "sm";
export type Role = "admin" | "teacher" | "student";
export type DocumentKind = "syllabus" | "project_plan" | "project_guidelines";