# Course Tracker

Course Tracker helps a Digital Marketing with AI institute manage module teachers, weekly attendance, 15-day assessments, and student progress reports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/course-tracker/src/` — responsive React dashboard and role-based auth screens
- `artifacts/api-server/src/routes/auth.ts` — login, registration, sessions, and logout
- `artifacts/api-server/src/routes/data.ts` — admin, teacher, and student data workflows
- `lib/db/src/schema/index.ts` — PostgreSQL/Drizzle schema for users, sessions, attendance, and assessments
- `lib/api-spec/openapi.yaml` — source of truth for the generated API client and validation schemas
- `artifacts/course-tracker/src/index.css` — Course Tracker visual tokens and responsive styles

## Architecture decisions

- Usernames/passwords are required by the product brief, so sessions use random HTTP-only cookies backed by hashed session records in PostgreSQL; passwords use Node's scrypt.
- Students self-register and are assigned stable IDs such as `STU001`; teachers are scoped to one of the three modules.
- Attendance and assessment writes are bulk endpoints so a teacher can save a full week or cycle in one action.
- The default configuration exposes 12 attendance weeks and 6 assessment cycles while report generation expands when later records exist.

## Product

- Admins can manage one teacher per module, search the student register, and inspect all records.
- Teachers can record weekly Present/Absent attendance and enter marks plus feedback for 15-day cycles for their module.
- Students can register without approval and view attendance summaries, weekly status, assessment marks, and feedback.
- The app is responsive, with role-aware navigation and mobile-friendly screens.

## User preferences

- Keep the experience straightforward enough for a non-developer to maintain with AI assistance.

## Gotchas

- The default admin account is `admin` / `admin123`; change it through the account management flow before real use.
- Run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`.
- Run `pnpm --filter @workspace/db run push` after changing `lib/db/src/schema/index.ts`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
