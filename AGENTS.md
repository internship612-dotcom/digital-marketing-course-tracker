# AGENTS.md — Course Tracker (Digital Marketing with AI)

Living notes for every agent working in this repo. Read this before changing code. `CLAUDE.md` has
the older, very detailed history; this file records the **latest pass** and the current operating
rules. Where the two disagree, this file wins.

## What this app is

Institute management app for a six-month "Digital Marketing with AI" course. Three roles:

- **Admin** — branches, modules, teacher logins, student register, reports, announcements, course files.
- **Branch** — a branch desk that owns its modules, module logins and branch notices.
- **Teacher (module owner)** — attendance, marks, project submissions, notices, course files for one module.
- **Student** — own attendance, marks, project link, notices, course PDFs.

Hard rule: a module owner never sees anything outside their module; a branch desk never sees another
branch. Isolation is enforced on the API by session (`branchId` / `module`), not by request bodies.

## Stack

- pnpm workspaces, Node 24, TypeScript 5.9
- API: Express 5, bundled with esbuild → `artifacts/api-server/dist/index.mjs`
- DB: PostgreSQL + Drizzle; boot-time `ensure*()` migrations (no hand-run SQL in production)
- Frontend: React + Vite + Tailwind + Wouter + TanStack Query, all screens in
  `artifacts/course-tracker/src/App.tsx`
- Auth: local API sessions (per-role cookies `ct_session_admin|branch|teacher|student`). Supabase is
  **admin sign-in only**; everything else is the app database.

## Build & run

```bash
# frontend (from artifacts/course-tracker)
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/vite/bin/vite.js build --config vite.config.ts

# API (from artifacts/api-server)
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node build.mjs

# local DB + API
node scripts/start-db.mjs          # embedded Postgres on 127.0.0.1:5433
node dist/index.mjs                # API on :5000, also serves dist/public
```

Local env: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/course_tracker`,
`SESSION_SECRET` (>=16 chars) for anything beyond dev. Use `127.0.0.1`, not `localhost` — the
embedded Postgres only listens on IPv4 loopback and dies if its shell is killed.

`pnpm` has no `.cmd` shim on this machine; run the underlying tools directly as above. `pnpm run
typecheck` / `pnpm run build` will fail with "'pnpm' is not recognized".

## Changes in this pass (what was done and why)

### 1. Login screens and themes

- Four panel themes live as `[data-theme='...']` blocks in `src/index.css`: `admin`, `zedking`,
  `branch`, `student`. A fifth, **`module`** (deep violet / lilac), was added this pass so a module
  desk no longer looks identical to the branch it belongs to.
- `src/themes.ts` maps roles to themes. Branch role → `zedking` (Zedking) or `branch` (others).
  Module owner → **`module`** (new, distinct purple). Admin → `admin`, student → `student`.
- `src/login-themes.ts` mirrors the panel tokens so each sign-in page matches the panel behind it.
- Module login (`/<module-code>`) uses the purple `module` theme with the module's own badge, heading
  ("Sign in to your <Module> desk") and subtitle. Branch login keeps the branch/zedking theme.
- `.auth-shell` got `min-height: 100dvh; overflow: hidden` so decorative circles cannot create
  sideways scroll/extra blank area on mobile.

### 2. Login-code resolution (branch vs module)

- Public endpoint `GET /api/login-code/:code` returns `{ type: 'branch' | 'module', id, name,
  branchName, logoUrl }`.
- The SPA resolves a login code **API first**, then falls back to the Supabase `resolve_login_code`
  RPC. This fixed stale Supabase mappings where a module code was resolved as a branch (and showed
  the branch login page).
- Branch and module records carry stable, unique `login_code` values. Admin-created branches get a
  generated code; seeded modules keep `ai`/`dm`/`sm` as ids.

### 3. Branches and modules

- Admin branch dashboard: create branches (name + owner username + password), add modules per
  branch, copy each branch/module login link.
- `GET /api/admin/branches` returns each branch with `loginCode`, `logoPath` and its modules (also
  with `loginCode`), so the UI can build `/<code>` links without guessing.
- Branch desk routes are scoped by the session's `branchId`.
- Per request, the admin **branch → module** page (`/admin/branch/:branchId/module/:module`) no
  longer renders the "Module team / Instructors" profiles block or the "Login access / Teacher
  logins" block. The page now shows the module header, status section and report only. Nothing else
  on that page changed.

### 4. Announcements

- Redesigned `NoticeRow`: accent strip, gradient header, module/status pills, "Auto" badge for
  automated notices, icons, larger readable type.
- Details open in a **separate full-screen dialog rendered through `createPortal` to
  `document.body`** (z-index 100). Earlier the dialog lived inside the notice card and inherited its
  layout, which made it look like it opened inline; the portal makes it a real overlay.
- Admin announcements list is now **filtered to the module selected in the compose form**. The
  branch picker + module picker drive both compose and list, so only that module's notices appear
  (with a single module heading). Teachers remain scoped to their own module by the API.
- Unread indicator in the sidebar: count pill on "Announcements" (9+ cap) and a dot on the mobile
  hamburger. Visiting the announcements page marks them seen; the badge polls every 60 s.
- Automated project reminders are **per-student** (`announcements.student_id`). A student sees
  notices where `student_id IS NULL` (module-wide) or `student_id = their own`. Staff still see all
  of their module's notices.
- Reminder text is short and readable (no raw URLs): project number, month/project position, plan
  and guidelines availability, due date and where to submit. The dialog adds **Project Plan** and
  **Project Guidelines** buttons that open the module's PDFs (or say "not uploaded yet").
- Legacy auto notices that embedded `/api/student/documents/...` links have those lines stripped in
  the UI, so old rows also read cleanly.

### 5. Project submissions

- Students paste a project link in **My Project**; any `http://` or `https://` URL is accepted
  (website, game, Drive, GitHub, deployed app…). `javascript:`, `data:` and `file:` are rejected.
  Name ≤100 chars, link ≤500 chars. Links are rendered as plain text only (no HTML injection).
- Once marks exist for that (student, module, cycle), the submission is **locked** (API 409); staff
  can still see the link with the marks.
- Table: `project_submissions` (student, module, cycle, name, link, submitted_at, updated_at),
  created by a boot migration.

### 6. Automatic project reminders

- Cycles run every 15 days from each student's `dateOfJoining`, up to 12 cycles (two projects per
  month for six months).
- `runAutoProjectReminders()` runs **at boot and then hourly**. It is idempotent: duplicates are
  prevented by `(studentId, module, authorName = "Auto: Project N Reminder")`, so a missed day is
  caught up on the next run without spam.
- Admin trigger: `POST /api/admin/announcements/auto-project-reminders` (idempotent, returns counts).
- Notices are published immediately and scoped to the student as above.

### 7. Database / schema changes

- `announcements.student_id` (nullable FK → students, `ON DELETE CASCADE`) + boot
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- `project_submissions` table + boot creation.
- `branches.login_code` / `branches.logo_path`, `modules.login_code`, `students.branch_id`.
- `attendance.leave_days` (bitmask: leave counts as attended; `locked_days` still distinguishes a
  recorded absent from an untouched day).
- `calendar_events` (institute-wide; unique `date`, no module column — a PTM/holiday stops all
  modules).
- All structural changes are applied by `ensure*()` functions chained before `listen()` in
  `artifacts/api-server/src/index.ts`; hosted DBs need no manual SQL.

### 8. Auth/session notes

- One cookie per role, so admin/branch/teacher/student can be signed in side by side. Cookies are
  browser-session cookies (no Max-Age); the `sessions` row has a 14-day server cap.
- Admin Supabase session is stored in `sessionStorage` (not `localStorage`) so closing the browser
  signs the admin out.
- Any admin re-authentication (reveal teacher password, change/delete a login) must verify against
  **Supabase**, because `admins.password_hash` is only a mapping row. The old
  `POST /admin/account/verify-password` endpoint still exists but the UI verifies through Supabase.

### 9. Course months, attendance and events

- The course is **six calendar months starting with the joining month**; month 1 runs from the
  admission date to the end of that month, months 2–6 are whole calendar months. Sunday is never a
  teaching day; a student joining on the last Sunday of a month starts on the 1st of the next month.
- Attendance percentages come from the mon..sat day flags (not `attendance.status`). Leave counts as
  attended.
- Institute events (PTM/holiday/exam) are recorded once against a date and excluded from every
  module's denominator. `GET /api/admin|teacher|student/events?from=&to=`; `POST` upserts;
  `DELETE /:date` removes.
- The day register (`/teacher/attendance`) is editable; saving again overwrites that day only.
  Event days hide the register and show "Remove event".

### 10. Deployment

- One process serves both API and SPA: `express.static` on `artifacts/course-tracker/dist/public`
  plus an SPA fallback for non-`/api` GETs. A missing client build logs a warning and serves `/api`
  only.
- `.replit` deployment runs `pnpm run build` then
  `pnpm --filter @workspace/api-server run start`.
- Production needs `DATABASE_URL`, `SESSION_SECRET` (server refuses to boot without it) and
  preferably `ADMIN_DEFAULT_PASSWORD`. See `.env.example`.
- Pushing to `origin/main` is what triggers the Replit autoscale deploy for this repo.

## Gotchas

- `/admin/students/status` must be declared before `/admin/students/:id`.
- Postgres `date` columns come back as local-midnight `Date` objects; select `date::text` when the
  literal stored date matters (IST otherwise reads a day early).
- A native `<input type="date">` follows the browser locale; enrolment uses DD/MM/YYYY selects.
- Marks save with an empty marks box writes `null` and wipes the previous value — there is no
  confirm step.
- Course PDFs live in the DB (base64 in `course_documents`) because the deploy filesystem is
  ephemeral. Downloads are `Cache-Control: no-store` and URLs carry `?v=<updatedAt>`.
- `express.json` limit is 12 MB to fit an 8 MB PDF as base64.
- Do not reintroduce committed defaults for `SESSION_SECRET` or the seeded admin password.
- After API source edits: rebuild (`node build.mjs`) **and** restart the process. Vite dev server is
  not used here; test through the API-served build on :5000.
