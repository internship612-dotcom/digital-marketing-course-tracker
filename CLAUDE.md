# CLAUDE.md — Course Tracker (Digital Marketing with AI)

Work-in-progress notes for Claude/upstream agents. Read this file before making changes.

## What this project is

Course Tracker is an institute management app for a "Digital Marketing with AI" course. It lets an
institute run three modules — **Artificial Intelligence (ai)**, **Digital Marketing (dm)** and
**Social Media (sm)** — with three user roles:

- **Admin**: manages the teachers of each module, creates/deletes teacher logins, registers/admin-resets
  students, searches the student register, inspects records, and sees per-module attendance/assessment
  status.
- **Teacher**: belongs to exactly one module (several teachers may share a module) and records
  weekly attendance, daily attendance, and 15-day assessment marks + feedback for that module only.
- **Student**: self-registers and views their attendance summary, weekly status, marks and feedback.

Core rule: teachers must **never** see anything outside their own module (isolation via role + module
scoping on both API and UI).

## Stack & tooling

- pnpm workspaces monorepo, Node.js 24, TypeScript 5.9
- API: Express 5 (bundled with esbuild -> `artifacts/api-server/dist/index.mjs`)
- DB: PostgreSQL + Drizzle ORM; validation via Zod (`zod/v4`) and `drizzle-zod`
- API client + validation: **Orval codegen from `lib/api-spec/openapi.yaml`**
- Frontend: React + Vite + Tailwind CSS + Wouter routing + TanStack React Query
- Auth: Supabase (admin login + exchange) **and** local API sessions (cookies), passwords scrypt-hashed
- Build/verify: `pnpm run typecheck`, `pnpm run build`

## Workspace layout

```
lib/
  db/                    # Drizzle schema (src/schema/index.ts) + db config
  api-spec/openapi.yaml  # source of truth for generated client/schemas
  api-zod/               # generated zod schemas (from openapi)
  api-client-react/      # generated react-query hooks + types (from openapi)
artifacts/
  api-server/            # Express API (src/index.ts, src/app.ts, src/routes/*)
  course-tracker/        # React SPA (src/App.tsx holds nearly all screens)
  mockup-sandbox/        # throwaway mockups
scripts/                 # repo-level scripts (tsx runner)
```

## Run & operate (local dev)

Services run on fixed ports:

| Service      | Port | How it runs            |
| ------------ | ---- | ---------------------- |
| PostgreSQL   | 5433 | embedded postgres      |
| API server   | 5000 | `dist/index.mjs`       |
| Vite dev     | 5173 | `vite --config vite.config.ts` |

Commands (from repo root):

- `pnpm run typecheck` — typecheck all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run build` — rebuild API bundle into `dist/` (esbuild)
- `pnpm --filter @workspace/api-server run start` — start API from compiled bundle
- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks/validation after editing openapi.yaml
- `pnpm --filter @workspace/db run push` — push schema changes to local Postgres (dev only)

Local dev helper scripts/logs/cookies live under `%TEMP%/opencode/` (`start-db.cmd`,
`start-api.cmd`, `start-vite.cmd`, `api.log`, `api.err`, cookie jars `cj.txt`, `cj2.txt`).
After changing API source you must rebuild **and** restart the API process.

Required env for API: `DATABASE_URL=postgres://postgres:postgres@localhost:5433/course_tracker`
(already set inside the start scripts). Frontend proxies `/api` -> `API_PROXY_TARGET`
(default `http://localhost:5000`) via `vite.config.ts`.

## Database schema (`lib/db/src/schema/index.ts`)

- `admins` — id (serial), username unique, password_hash (scrypt), display_name, module (unique, default ai)
- `teachers` — id, username unique, password_hash, module (**not** unique — a module can hold several logins), display_name, **plain_password** (stored so admin can reveal it)
- `students` — id (STUxxx), full_name, fathers_name, course, date_of_joining, contact_number, email unique, password_hash, **plain_password** (revealable, same deliberate trade-off as teachers), **photo** (data URL of a small square JPEG), **remark** (free-text staff note), **address**, **guardian_contact** (both optional, added later, so old rows are null)
- `attendance` — PK (student_id, module, week); status present/absent; mon..sat booleans;
  **locked_days** (int bitmask, bit 0 = mon … bit 5 = sat — which days have actually been saved and
  are therefore closed to edits; a recorded absent and an untouched day both leave the day flag
  false, so this is the only thing that tells them apart); recorded_by (teacher), recorded_by_admin
- `assessments` — PK (student_id, module, cycle); marks, feedback, **project_name** (typed by the
  module owner), entered_by / entered_by_admin
- `announcements` — id (serial), module, title, body, author_name, created_by (teacher, set null),
  **published_at** (null = draft), created_at, updated_at
- `course_documents` — PK (module, kind) where kind is syllabus | project_plan |
  project_guidelines; file_name, content_type, size_bytes, **content** (base64 of the PDF),
  uploaded_by_name, created_at, updated_at. The composite PK is the whole replace story: an upload
  upserts, so there is only ever one current file per slot.
- `sessions` — token_hash unique, role, user_id, expires_at (14-day server-side cap; the **cookie**
  itself carries no Max-Age, so it dies when the browser closes)

Default seed: one admin row `admin` / `admin123` (created by `ensureDefaultAdmin()` in
`lib/auth.ts`), module `ai`.

## Auth model (read carefully — this bites often)

Two auth paths coexist:

1. **Local API sessions** — `POST /auth/login` (role=student|teacher|admin) sets an HttpOnly
   cookie backed by a `sessions` row (HMAC-hashed token, scrypt-hashed passwords). The cookie
   deliberately carries **no Max-Age/Expires**, so it is a browser-session cookie: closing the
   browser signs all three portals out. The row's 14-day `expires_at` is only a server-side cap.
   There is **one cookie per role** — `ct_session_admin`, `ct_session_teacher`,
   `ct_session_student` — so all three can be signed in in the same browser at once. Which one
   `resolveAuth` picks comes from `requestedRole(req)`: the `x-ct-role` header if the SPA sent
   one, else the API path (`/admin/*`, `/teacher/*`, `/student/*`), else "first session found".
   `destroySession` only clears the requested role, so signing out of one desk leaves the
   others alone. The pre-split `ct_session` cookie still resolves (the `sessions` row is what
   says which role it is) and is expired on the next login.
2. **Supabase admin login** — the frontend Admin sign-in (`AdminLoginPage`) uses
   `supabase.auth.signInWithPassword()` with the admin email `zedkingservice@gmail.com`
   (constants in `artifacts/course-tracker/src/lib/supabase.ts`, which pins Supabase's storage to
   **`sessionStorage`** — the default `localStorage` would survive a browser close and leave the
   admin signed in). The SPA then calls
   `POST /auth/admin/supabase` with the Supabase access token; the API verifies the email via
   Supabase's `/auth/v1/user` and creates a **local** admin session mapped to the local `admins`
   row (falls back to the `admin` row). So the admin's *real* password lives in Supabase, NOT in
   the `admins` table (whose row still holds the `admin123` scrypt hash). This mismatch is why any
   "re-enter admin password" check must be verified against **Supabase**, not `admins.password_hash`.

`lib/auth.ts` exports: `hashPassword`, `verifyPassword`, `createSession`, `destroySession`,
`resolveAuth`, `attachAuth`, `requireRole(...roles)`, `ensureDefaultAdmin`, `publicUser`.

## API endpoints (`artifacts/api-server/src/routes/`)

Health:
- `GET /healthz`

Auth (`routes/auth.ts`):
- `GET  /auth/me`
- `POST /auth/login` (role student|teacher|admin)
- `POST /auth/register` (student self-registration)
- `POST /auth/register-admin`
- `POST /auth/logout`
- `POST /auth/admin/supabase` (exchange Supabase token -> admin API session)
- `PATCH /admin/account/password` (change admin password, checks currentPassword vs `admins`)
- `POST /admin/account/verify-password` (role=admin) — checks passphrase vs `admins.password_hash`.
  NOTE: after the reveal/edit fix the frontend no longer calls this; it verifies via Supabase
  directly. Endpoint still exists.

Data (`routes/data.ts`, all role-scoped):
- `GET   /admin/summary` — per-module dashboard counts
- `GET   /admin/teachers`
- `POST  /admin/teachers` — create teacher. A module may hold several logins, so only the username
  has to be free; a duplicate returns **409** `"That username is already in use."` A create never
  touches the module's existing logins.
- `PATCH /admin/teachers/:id` — update (rename/change password). Pre-checks the username against
  *other* rows (409).
- `DELETE /admin/teachers/:id`
- `GET   /admin/students`, `POST /admin/students`
- `GET   /admin/students/:id`, `DELETE /admin/students/:id`
- `PATCH /admin/students/:id/password`
- `GET   /admin/attendance`, `GET /admin/assessments` (cross-module admin views)
- `GET   /teacher/students`, `POST /teacher/students` — module owners enrol students from
  their own desk. Students are global (no module column), so this mirrors `POST /admin/students`
  exactly; it is **not** exposed in openapi.yaml, so the frontend calls it with plain `fetch`.
- `GET   /teacher/attendance`, `POST /teacher/attendance/bulk`
- `GET   /teacher/assessments`, `GET /teacher/assessments/cycle-summary`, `POST /teacher/assessments/bulk`
- `GET   /teacher/attendance/daily`, `POST /teacher/attendance/bulk/daily`
- `GET   /teacher/attendance/week-summary`
- `GET   /admin|teacher/students/:id/report` and `GET /student/monthly` — both call
  `buildStudentReport`, so a student and their teachers always see identical numbers.
  `{ joinedOn, overall, months[6] }`; each month carries `start / end / present / absent /
  total / percentage` plus a per-module breakdown that also embeds that module's two `projects`.
- `GET   /admin|teacher/students/:id/detail` — one handler on both prefixes (Express route array +
  `requireRole("admin","teacher")`); `requestedRole()` resolves the right session from the path.
- `GET   /admin|teacher/students/:id/credential` — `{ password }`, the only call that returns it.
  Deliberately **not** on `studentView`, so no list response can leak it. Null for students
  enrolled before `plain_password` existed — reset the password to populate it.
- `PATCH /admin|teacher/students/:id/photo` — `{ photo }` data URL (png/jpeg/webp, ≤1.5 MB) or
  `null` to clear. `express.json` runs with a **2mb limit** for this.
- `PATCH /admin|teacher/students/:id/remark` — `{ remark }` (trimmed, ≤2000 chars; empty or
  `null` clears it). Returns the updated `studentView`, so the caller can swap it straight in.
- `DELETE /teacher/students/:id` — module owners manage the same roster as the admin.
- `PATCH /teacher/students/:id/password` — teacher-side twin of the admin reset. Both write
  `plain_password` alongside the hash, or the reveal would go stale.
- Attendance percentages come from the **mon..sat day flags**, not `attendance.status` — the
  teacher UI always writes `status: "present"`, so a status-based percentage is always 100% and
  meaningless.
- The course runs **six months from the admission date**, sliced **admission-to-admission**: month
  N runs from the admission day-of-month N-1 months on, to the day before month N+1 starts. A
  student admitted on the 5th gets 5 Sep → 4 Oct, 5 Oct → 4 Nov, and so on — **always exactly six
  contiguous slices**, no stub. (It used to slice by calendar month, which gave a short first *and*
  last slice — seven in total — and that is the bug section 7 fixed.) Sundays are excluded, so
  `total` is that slice's actual teaching-day count, never a flat figure. `buildStudentReport`
  converts each stored `(week, day-flag)` pair back into a real date via the Monday of the joining
  week, then files it under the slice it falls in. A day counts as present when the student
  attended **any** module that day, so the month total is days, not days × modules.
- `GET   /teacher/overview/students` — now `{ attendance[], assessment[], pendingAttendance{},
  pendingMarks{} }` from `buildStatus()`, and measured against **today**, not the whole course:
  the id arrays list who is *clear right now*. Attendance is clear once today has been marked (P
  or A) and goes outstanding again tomorrow; Sunday is the only free pass, and a student outside
  their course window counts as outstanding. Marks are clear while every project whose due date
  has passed has marks (project 1 due mid-month, project 2 at month end). Backs the two read-only
  icons on the student list.
- `GET   /teacher/attendance/daily` — **omit `?month=`** to get every week (the calendar needs
  the whole course); passing a month keeps the old 4-week behaviour.
- `GET   /teacher/overview` — period-free module glance: `{ totalStudents, attendanceMarked,
  attendancePending, assessmentMarked, assessmentPending }`, counting **distinct students** the
  module has recorded at least once (marks must be non-null). Not in openapi.yaml; called with
  plain `fetch`.
- `GET   /admin/modules/:module/attendance`
- `POST  /admin/modules/:module/attendance`
- `GET   /admin/modules/:module/attendance/daily`, `POST .../daily`
- `GET   /admin/modules/:module/attendance/summary` — returns `{ totalStudents, marked,
  studentsMarked, studentsPending, pending, assessmentMarked, projects[{cycle,marked}] }`
  (used by the admin status labels)
- `GET   /admin/modules/:module/activity`
- `GET   /admin/modules/:module/assessments`, `POST .../assessments`
- `GET   /student/attendance`, `GET /student/assessments`
- `GET   /student/profile` — the student's own basic details for "My profile": name, father's
  name, course, address, contact, email, photo. Deliberately narrow — **no remark, no password**.
- `GET   /teacher/attendance/day?date=YYYY-MM-DD` — one row per student for a single calendar
  date: `studentView` plus `{ week, eligible, present, recorded, locked }`. `eligible` is false on
  a Sunday or outside that student's course; `locked` means that day has already been saved.
- `POST  /teacher/attendance/day` — `{ date, present[], absent[] }`. Ticked ids become present,
  the `absent` list becomes absent, and anyone in **neither** array is left untouched. Only the
  one day moves — the rest of the student's week row is preserved — and a day whose `locked_days`
  bit is set is refused. Returns `{ saved, skipped, locked }`.
- `GET   /admin/students/status` — the admin twin of `/teacher/overview/students`, across all
  three modules. **Registered ahead of `/admin/students/:id`** or Express reads "status" as an id.
- `GET   /teacher/announcements`, `POST /teacher/announcements` (`{ title, body, publish }`),
  `PATCH /teacher/announcements/:id` (`{ publish }` and/or new wording), `DELETE .../:id` — all
  scoped to the caller's module, so another desk's notice is a 404.
- `GET   /student/announcements` — every **published** notice from all three modules, newest first.
- `GET   /admin/announcements`, `POST /admin/announcements` (`{ module, title, body, publish }`),
  `PATCH /admin/announcements/:id`, `DELETE /admin/announcements/:id` — the institute-level twin of
  the teacher routes. Deliberately **not** module-scoped: the admin reads every module's notices and
  can publish, take down or delete one a module owner wrote. `POST` takes the target `module` in the
  body (a bad value is a 400) and writes `created_by: null`, because that column references
  `teachers.id` and an admin has no row there — the author shows through `author_name`.

- `GET /admin|student/documents` (all modules) and `GET /teacher/documents` (own module) —
  metadata only; the bytes never ride along in a list response.
- `GET /admin|teacher|student/documents/:module/:kind/file` — one handler on all three prefixes,
  `requireRole("admin","teacher","student")`. Streams the PDF `inline` with `Cache-Control:
  no-store`, because staff replace a file under the same URL and a cached copy would hide the new
  one. Students may read **any** module's file — they take all three.
- `POST /admin/documents` (`{ module, kind, fileName, content }`) / `POST /teacher/documents`
  (module comes from the session). `content` is base64 or a `data:` URL, since the browser's
  `FileReader` hands back the latter. Validation is name **and** bytes: `.pdf` extension, a
  `%PDF-` magic-number check so a renamed `.docx` cannot slip through, and an 8 MB cap.
  Upserts on (module, kind).
- `DELETE /admin/documents/:module/:kind` / `DELETE /teacher/documents/:kind`.

## Frontend (`artifacts/course-tracker/src`)

- `App.tsx` holds virtually all screens (big file): auth pages, `ModuleDetailPage`,
  `ModuleStatusSection`, `AdminModulesPage`, `AdminPanelLoginsPage`, `AdminStudents` pages,
  `TeacherPage`, `TeacherStudentListPage`, `TeacherAddStudentPage`, `StudentPage`,
  `AdminModuleReportPage`, `Router` (wouter).
- `StudentEnrolForm` is the single enrolment form; `AdminStudentsPage` and `TeacherAddStudentPage`
  are thin wrappers that only differ in how they create (`useCreateStudent` vs `POST /teacher/students`).
- Sidebar nav (`Shell`) is two levels: "Add student" reveals its "Student list" child on
  hover/focus, and the child stays pinned open while you are on one of those pages. Admin and
  teacher both get the pair — teacher's point at `/teacher/add-student` and `/teacher/students`.
- The module desk (`TeacherPage`) is **three cards and no period picker**: total students, then
  an `ProgressCard` each for attendance and assessments showing `done / total` with a bar and a
  marked-vs-pending line. It reads `GET /teacher/overview`, which is deliberately period-free —
  a picker-less desk cannot honestly show a per-week number, so the desk answers "who have I not
  touched at all" and week-by-week detail lives one click away.
- `TeacherStudentListPage` and `AdminEnrolledPage` share `StudentTable` (a wide table that scrolls
  sideways). Search filters across every field client-side. The last three columns are
  **Attendance**, **Marks** — two read-only `StatusIcon`s, green/red against today — and the
  remark/delete actions. Marking happens elsewhere: attendance on `/teacher/attendance`, marks on
  the student record. See section 7. *The chips and modals described below were removed:*
  - `AttendanceCalendarPanel` — a real month calendar, browsable to any month.
    `weekNumberFor(date, anchor)` maps a date back to the stored week number, where the **anchor
    is the Monday of the student's own `dateOfJoining`** — so week 1 is the week each student
    enrolled and there is no fixed course length (`MAX_WEEK` 52 is just a sanity bound). Sundays
    and dates before the student enrolled are inert. It loads **all** weeks up front and on save
    posts whole week records for only the weeks you touched — `/teacher/attendance/bulk/daily`
    replaces a week's row wholesale, so a partial week would wipe days you could not see.
  - `AssessmentPanel` — month + project selects (two projects a month, `cycle = (month-1)*2 +
    project`), marks and feedback.
  Saving refreshes the chips; the desk and the admin report re-read on their next mount.
- `StudentTable` is the one row-per-student table (min-width ~1240px, scrolls sideways rather
  than wrapping): serial number, student ID, `StudentAvatar`, then the rest. Both
  `TeacherStudentListPage` and `AdminEnrolledPage` render it, differing only in the `action`
  column, so the two portals read identically; both put `StudentSearchBar` **above** the card and
  open `StudentDetailPage` on row click. `studentMatches` is the shared search predicate.
- `StudentDetailPage({ scope })` serves `/admin/students/:id` and `/teacher/students/:id` off the
  same code, fetching `/api/{scope}/students/:id/...`. It holds the full record, the photo
  (uploaded through `readSquarePhoto`, which centre-crops and downscales to a 320px JPEG in the
  browser so a phone photo does not arrive as megabytes), the password reveal, and the reset.
  `MonthlyProgress` is the single month-switching report: one `<select>` drives both the
  attendance tiles (percentage / present / absent, then a per-module row) and the project-marks
  cards (one card per module, both of that month's projects). `StudentPage` renders it full size;
  `StudentProgressSection` renders it `compact` under the record card, so the student and their
  teachers read the same screen. `monthRange` labels each month with real dates off `joinedOn`.
- The actions column of `StudentTable` is the last column and scrolls with the rest of the table
  (it was briefly `sticky right-0`; the chips then sat over the details you were scrolling to).
  `RecordActions` renders the shared remark + delete buttons for both portals, and `RemarkPanel`
  is the editor behind them.
- `ModuleStatusSection` (admin module report) answers in **students**: "N of M students uploaded /
  K not uploaded" with a bar, plus a per-project breakdown. A student counts as done for
  assessments only once both of that month's projects carry a mark.
- `StudentPage` reads `/student/monthly`: overall attendance %, then a card per recorded month
  with its percentage, a bar and a per-module split, followed by a project-marks table that
  labels cycles as Month N / Project 1-2.
- `AdminSettingsPage` (`/admin/settings`, linked from a Settings button above the sidebar user
  card) holds the admin password reset, which goes through **Supabase** (`signInWithPassword` to
  re-verify, then `updateUser`) because `PATCH /admin/account/password` only touches the
  `admins` row that nobody signs in with.
- The sidebar user card shows name + module short code only (no role word) and Sign out.
- `Main` entry `src/main.tsx`; visual tokens/styles in `src/index.css`.
- `Logo` is the institute wordmark `src/assets/zedking-logo.png` (imported, so Vite hashes it and
  handles `base`) with **"Course Tracker" stacked underneath** between two hairline rules. Stacked,
  not side by side: the artwork is a ~4:1 lockup, so setting the product name beside it would
  overrun the 256px sidebar. The old "ct" tile is gone. The artwork is dark blue / red / black on a
  **transparent** background, so `dark` (sidebar, sign-in panel) puts it on a **white plate** — on
  the navy sidebar it would otherwise be invisible, and tinting or inverting would destroy the
  brand colours. The link is `w-fit self-start`, or a flex-column parent stretches it and the rules
  run the width of the panel.
- **Favicon** is the globe-and-crown mark **cropped out of** the wordmark (x 624-726, y 2-120 of
  the original PNG), centred on a square canvas, shipped at `public/favicon-{16,32,48}.png` plus a
  180px apple-touch icon, each `<link>`ed with its `sizes`. The full lockup was not usable: at 16px
  a 4:1 wordmark is an unreadable smudge, whereas the globe and crown still read. Exact sizes
  rather than one large PNG, because leaving the browser to reduce a 64px icon to 16px is where the
  mush came from.
- **Both the logo and the icons are resampled offline, not by the browser.** The originals are
  trimmed of their transparent margin and run through a Lanczos-3 filter on **premultiplied**
  alpha (filtering raw colour channels pulls the colour of transparent pixels into the edges and
  haloes the artwork). Chrome's own downscale at 5:1 was what made the strapline blurry. If the
  branding changes, regenerate from the source art the same way — do not just point the `<img>` at
  a full-size original and let CSS shrink it.
- `logo zk.pdf` on the Desktop is **not** a better source: it is a single quality-60 1024x1024
  JPEG, no vector paths. `zedking logo.png` (998x250, lossless) is the master.
- **One typeface: Inter.** All three tokens (`--app-font-sans`, `--app-font-serif`,
  `--app-font-mono`) point at it, so `.font-display` and `.font-mono-ui` are Inter too. The small
  tracked labels still read as labels because the effect was always the uppercasing and
  letter-spacing, not a monospace face. Weights 400-900 are requested in **both**
  `index.html` and the `@import` at the top of `index.css` — keep the two lists in step or the
  heavy display headings fall back and re-render.
- `src/components/ui/` — shadcn-style component library (Radix + Tailwind).
- `src/hooks/use-toast.ts`, `src/lib/utils.ts`, `src/lib/supabase.ts`,
  `src/lib/email-validation.ts`.
- Admin routing is double-gated: `useAdminSession()` (Supabase email check) **and**
  `useAdminBackendSession(enabled)` (exchanges for the API-admin session before `/api` calls are
  allowed). It is passed `role === 'admin'` so the exchange never fires on a module-owner route.
- `workspaceRole(pathname)` maps the current page to a role and feeds both `setRoleHintGetter()`
  (which attaches `x-ct-role` to every generated-client call) and `useCurrentUser()`, whose
  react-query key is `[...getGetCurrentUserQueryKey(), role]`. Without that per-role key,
  walking from the admin desk into a module panel would reuse the admin answer from cache.
  Note `/admin/<module>` is a **module owner** route while the rest of `/admin/*` is the admin desk.
- `PasswordField` is the shared reveal-toggle password box; every sign-in screen uses it.

## Work done so far (and how)

### 1. Project scaffold
Initial commit set up the pnpm-workspaces monorepo (db, api-zod, api-client-react, api-server,
course-tracker), the OpenAPI->Orval codegen loop, and the baseline Express API with scrypt-hashed
passwords and cookie sessions. A later commit ("Update api server and regenerate client schema
bindings") tightened the schema/client (`module` enum ai|dm|sm, teacher uniqueness, plain_password)
and re-ran codegen.

### 2. Teacher workspace + stats
- Added teacher-scoped summary endpoints (`/teacher/attendance/week-summary`,
  `/teacher/assessments/cycle-summary`, plus daily attendance read/write and week/assessment bulk
  writes) in `routes/data.ts`.
- `TeacherPage` in `App.tsx` gained stat/summary rows fed by those endpoints.
  *(Superseded — see section 6: the desk is now three cards off `/teacher/overview`.)*
- Isolation: every teacher endpoint loads by `req.auth.userId` and matches `teachers.module` to the
  requested module; the SPA redirects teachers to only their module desk.

### 3. Admin dashboard & module detail (masked logins; reveal / change password / delete w/ confirmation)
- `AdminModulesPage`: 3 module cards + summary counts from `/admin/summary`.
- `ModuleDetailPage` (route `/admin/module/:module`):
  - **Module team** block at the top: **profiles only** — one card per instructor with the initials
    avatar, `Name:` and `Designation:` (`${moduleShort} Instructor`, e.g. "AI Instructor"). No
    credentials here. "Not assigned yet" when the module has none.
  - Below it, **Teacher logins**: **Create Login** (always available — a module may hold several
    logins) taking Name, User ID and password (min 6 chars, show/hide toggle), followed by one row
    per login showing `User ID:`, the password **masked** (`••••••••`) with an eye toggle, plus
    **Change password** and **Delete** buttons. Change password opens an inline "New password"
    field (min 6, own show/hide toggle) and saves via `PATCH /admin/teachers/:id` with only
    `{ password }`.
  - After a create, a one-off banner repeats the details with its own eye toggle and a dismiss `X`.
    That password needs no re-auth — the admin just typed it.
  - Revealing a listed password, changing it, OR deleting a login each first open an **admin
    confirmation popup**.
  - The popup now verifies the password against the currently logged-in admin's **own Supabase
    credentials** (`supabase.auth.signInWithPassword` with `adminSession.email`). This was a bugfix:
    it originally checked `admins.password_hash` (i.e. `admin123`), which is not the admin's real
    password. Applies to all three gated actions — reveal, change password, delete — on all 3 modules.
- `ModuleStatusSection` (below the login block): month selector + two cards from
  `/admin/modules/:module/attendance/summary?month=N`. *(Superseded — see section 6: they now read
  "N of M students uploaded / K not uploaded" with a bar and a per-project breakdown, and month N
  means each student's own admission-anchored calendar month.)*

### 4. Admin student management + logins panel
- Student register list/search, student detail with record info, admin-only password reset
  (`PATCH /admin/students/:id/password`), delete student.
- `AdminPanelLoginsPage` (`/admin/panel-logins`) is a **read-only overview**, one card per module
  listing *every* login it holds (name, username, password masked as `••••••••`) with a count badge
  and a link through to `/admin/module/:module`. It used to render `plainPassword` in clear text
  with a Copy button and an ungated edit form, which bypassed the admin-password gate — that was
  removed. All creating, revealing, changing and deleting happens only on `ModuleDetailPage`,
  behind the Supabase confirmation.
- The unrouted `AdminPage` component (a second, ungated teacher CRUD) was deleted as dead code.

### 5. Verification & local workflow
- `pnpm run typecheck` clean across packages; API rebuilt with `node ./build.mjs` and restarted
  whenever `routes/*` changes; endpoints smoke-tested with curl + cookie jars (e.g.
  `verify-password` returns 204 on correct / 400 on wrong).

### 6. Rework: sessions, calendar attendance, shared student screens

Everything below landed in one later pass. Where it contradicts sections 2-4, **this section wins**.

**Sessions — three roles side by side.** One `ct_session` cookie meant signing into a module desk
logged the admin out and the two gates fought each other ("it keeps going back"). Now there is a
cookie per role plus `requestedRole()` / `workspaceRole()`; see the Auth model section. Sign-out
clears the whole query cache and returns to that role's own sign-in, and `Protected` no longer
falls back to the Supabase admin, so no role can land in another's workspace.

**Attendance is now real-calendar.** `buildStudentReport` + `courseMonths()` are the single source
of truth, used by the student portal, the record screen and the admin module report. The course is
six months from the admission date, sliced by calendar month, so a mid-month admission gives a
short first slice and a short last one (10 Jun 2026 → 9 Dec 2026 = 7 slices, 18 … 8 days).
`/admin/modules/:module/attendance/summary` counts each student against **their own** month N.

**Module desk** (`TeacherPage`) replaced its register tabs with three cards — total students, and a
`ProgressCard` each for attendance and assessments — fed by `/teacher/overview`. Deliberately
period-free; the week-by-week work moved to the student list.

**Student list** (`TeacherStudentListPage` + `AdminEnrolledPage`) is one shared `StudentTable`:
serial number, student ID, photo, the rest of the fields, then the actions. Search sits above the
card. Chips open `AttendanceCalendarPanel` (a real month calendar anchored to the student's joining
week) and `AssessmentPanel` (month + project). `RecordActions` adds remark + delete on both portals.

**Student record** (`StudentDetailPage`, both portals) carries the full record, `MonthlyProgress`,
one "Photo & password" card with the revealable `plain_password`, and a remark card.

**Student portal** (`StudentPage`) is two tiles — total teaching days, and present/absent with the
overall percentage — over the same `MonthlyProgress`.

**Admin settings** (`/admin/settings`) resets the admin password through Supabase.

**Bugfixes worth remembering.** Enrolment's "Generate" minted two different passwords, so the saved
password was not necessarily the one written down; the module owner can now enrol students
(`POST /teacher/students`); every sign-in box has a reveal toggle (`PasswordField`).

### 7. Rework: day register, locked attendance, status icons, student pages, announcements

Landed in one later pass. Where it contradicts sections 2-6, **this section wins**.

**Course months are now admission-to-admission.** `courseMonths()` used to slice by calendar month,
which left a stub 7th slice for any mid-month admission (5 Sep 2026 → 7 slices). Month N now runs
from the admission day-of-month N-1 months on, to the day before month N+1 starts, so there are
**always exactly six contiguous slices** (5 Sep → 4 Oct, 5 Oct → 4 Nov, …). This feeds every
attendance figure in the app, and the marks form's month picker is 1-6 to match.

**Attendance moved off the student list onto its own page.** `/teacher/attendance`
(`AttendanceRegisterPage`), its own item in the module owner's sidebar. It opens on **today** and
re-reads the clock every minute, so a tab left open overnight rolls onto the new day by itself —
no date or month picker to touch. Each student row is the shared `StudentTable` with two
checkboxes in the last column: **P** ticks green, **A** ticks red, neither stays grey and is left
alone. `All P` / `All A` / `Clear` sit in that column's header, not in a toolbar. Sunday is inert.
The per-student `AttendanceCalendarPanel` and `StatusPill` were deleted — that chip was their only
entry point.

**Saved attendance is final.** `attendance.locked_days` is a mon..sat bitmask of the days that have
actually been submitted. It exists because a recorded *absent* and a day nobody touched both leave
the day flag `false`, so there was no way to tell them apart. `POST /teacher/attendance/day`
refuses to move a day whose bit is already set and reports how many it skipped; the register draws
those rows greyed with "Saved — locked". Locking is **per day**, not per week, so the rest of the
week stays open. Rows written before this column existed have `locked_days = 0` and are still
editable.

**The two chips became read-only icons, measured against the current date.** `StudentTable` gained
`statusFor` and two columns, `Attendance` and `Marks`, each a `StatusIcon` — green when there is
nothing outstanding, red when there is, and **not clickable**. Both `GET /teacher/overview/students`
(this module) and `GET /admin/students/status` (all three) now return
`{ attendance[], assessment[], pendingAttendance{}, pendingMarks{} }` from `buildStatus()`:
- attendance asks only about **today** — marked (P or A) is green, otherwise red, and tomorrow
  turns it red again. Sunday is the one exception (nothing is due). A student outside their course
  window — not started, or finished — counts as **outstanding**, which is the user's explicit
  choice: they wanted "not uploaded = red" even where the row cannot be marked.
- marks count the projects whose due date has passed: project 1 falls due halfway through its
  month, project 2 at the end of it.

**Marks moved to the student record.** `AssessmentPanel` is gone; `MarksUpload` sits under the
report on `StudentDetailPage` (teacher scope only — there is no module-scoped admin marks route).
The project select has **no default** ("Select project"), because marks overwrite silently. After
a save the form re-reads the record rather than emptying, and `assessments.project_name` is a free
-text name the module owner types, shown under "Project 1/2" in the report.

**Module-scoped report on the module desk.** `MonthlyProgress` takes `moduleFilter`; the teacher's
copy of a student record shows only their own module's attendance and marks, headline tiles
included. The admin's copy still shows all three.

**Student record screen.** Remark folded into the "Photo & password" card under the password block
(the separate remark card and its modal are gone). Enrolment gained a photo picker — the photo is
`PATCH`ed straight after the create, because the student only gets an id once the row exists — plus
optional **Address** and **Parent / guardian contact**. The joining date is three selects
(**DD → MM → YYYY**); a native `<input type="date">` renders in the browser's own locale, which was
showing MM first, and that is not controllable from CSS or markup.

**Student portal grew four pages.** Sidebar order: My profile, My progress (unchanged), Module
information, Project, Announcements.
- `GET /student/profile` → `StudentProfilePage`, read-only, deliberately narrow: name, father's
  name, course, address, contact, email, photo. **No remark, no password.** It reads the students
  row live, so staff edits show up on the student's next visit.
- Module information and Project now render the course PDFs; see section 8.

**Announcements.** New `announcements` table and a page on each side. A module owner writes a
notice, saves it as a **draft** or **publishes** it; only published notices reach students, and
"Take down" retracts one. A teacher only ever sees and edits their own module's notices (the
queries are scoped by `module`, so another desk gets a 404). Students see every published notice
from all three modules, newest first.

**Sign-out on browser close.** `setSessionCookie` no longer sends `Max-Age`, so all three role
cookies are **browser-session cookies** and every portal is signed out when the browser closes. The
Supabase admin session moved from `localStorage` to `sessionStorage` for the same reason. The
`sessions` row keeps its own 14-day expiry as a server-side backstop.

### 8. Admin announcements, collapsed notices, and the course PDFs

**Announcements reached the admin desk.** `TeacherAnnouncementsPage` became
`AnnouncementsPage({ user, scope })` — the same `scope` pattern `StudentDetailPage` already uses —
and `scope` picks the `/api/{scope}/announcements` prefix. The admin copy adds a **module picker**
on the compose form (the teacher's is fixed to their own module) and lists all three modules, so
the admin can write into any module and moderate anything. Sidebar item + route
`/admin/announcements`, registered **before** `/admin/:panel` or the module-panel catch-all eats it.
`workspaceRole()` already resolves it to `admin`, since only `/admin/<module>` means a module desk.

**A notice is a title until you click it.** `NoticeCard` was replaced by `NoticeRow`, which renders
the headline, the published/draft line and the author, and reveals the body only when opened. With
three modules posting into one portal the old expanded list buried each notice under the previous
one's body — that was the reported confusion.

**Notices are grouped by module, never interleaved.** `NoticesByModule` renders a section per
module (empty ones included, so a student can see there is simply nothing rather than wonder). It
takes a `modules` prop: the student portal and the admin desk pass all three, but a **module desk
passes only its own**, so an AI teacher no longer sees empty "Digital Marketing" and "Social Media"
headings for notices that were never theirs. The API was already module-scoped; this was purely the
UI drawing sections for rows it could never receive. The admin's old separate "Published" and
"Drafts" headings are gone — one module-grouped list with a status badge replaces them.

**Row actions are Publish (drafts only), Edit and delete.** "Take down" was **removed at the user's
request** and Edit put in its place. `NoticeRow` takes `editing` and swaps its body for a
title/message form that seeds from the stored values each time it opens, saving through the
existing `PATCH` (which already accepted new wording on both prefixes). The consequence is
deliberate and worth knowing: **there is no longer any way to unpublish a notice from the UI** — a
published notice can be edited or deleted, not retracted. `setPublished(id, false)` still exists on
the API and in the client, just with no button wired to it.

**Module information and Project serve real PDFs.** Both placeholder pages now render a section per
module off `adminModules`, reading `GET /student/documents` through `useCourseDocuments()`.
`DocLink` renders a missing entry as "Not uploaded yet" instead of a dead link.

### 9. Course files are staff-managed uploads

The PDFs started as static files in `public/docs/<module>/` with a hardcoded `moduleDocs` registry.
That meant a new syllabus needed a code change, so they moved into the database behind an upload
screen. The static copies were deleted — they also sat on unauthenticated URLs, which the API route
does not.

**Where the bytes live.** `course_documents`, base64 in a text column (the same trade-off
`students.photo` already makes), **not** on disk: the app deploys to an autoscale target whose
filesystem is ephemeral and not shared between instances, so an uploaded file would vanish on the
next redeploy.

**Replace is the primary action, not delete-then-upload.** The table's primary key is
(module, kind), and `POST` upserts onto it. Uploading a new syllabus overwrites the row in one
statement, so the old file stops being served the instant the new one lands and there is never a
moment with two versions or none. Remove is there separately, for taking a file down with no
replacement ready.

**Who can do it.** `CourseDocumentsPage({ user, scope })` — the same `scope` pattern as
`AnnouncementsPage` — at `/admin/documents` and `/teacher/documents`, both in the sidebar as
"Course files". The admin sees all three modules; a module desk sees only its own, and its API
routes take the module from the session rather than the request, like every other teacher route.

**Upload path.** `DocumentSlot` reads the file with `FileReader.readAsDataURL` and POSTs the data
URL as JSON — no multipart, no new dependency. `express.json` was raised from 2mb to **12mb** to
fit an 8 MB PDF plus base64's ~33% overhead. The server re-checks the size and the `%PDF-` magic
number; the client-side checks are only there to fail fast.

**Only the AI module's three PDFs exist today.** Digital Marketing and Social Media are uploaded
from the portal when they are ready — no code change needed any more.

## Gotchas / decisions

- **`/admin/students/status` must be declared before `/admin/students/:id`.** Express matches in
  order, so the `:id` route swallowed it and returned "Student not found."
- **Postgres `date` columns come back as local-midnight `Date` objects** through node-postgres, so
  `new Date(row.date_of_joining).toISOString().slice(0,10)` reads **a day early** in IST. Select
  `date_of_joining::text` when you want to see what is actually stored. The server is fine — Drizzle
  hands `dateOfJoining` over as a plain string.
- **Marks save with an empty Marks box writes `null`**, wiping whatever was there. There is no
  confirm step; the empty project default ("Select project") exists to make that harder to trigger
  by accident.
- **A native `<input type="date">` cannot be forced into DD/MM order** — it follows the browser's
  locale. The enrolment form uses three selects instead, and validates the combination (31 Feb is
  rejected) because selects cannot carry `required`.
- **Attendance has no Sunday column** (mon..sat only). Sunday is not a teaching day anywhere in the
  app; making it one would need a schema change *and* would move every existing percentage, since
  Sundays would join the denominator.
- **Enrolment "Generate" used to mint two different passwords** (`password: randomPassword(),
  confirmPassword: randomPassword()`), so the form always rejected the pair and whatever the admin
  wrote down was not necessarily what got saved. It now generates once and fills both. The enrol
  form also trims the email and password before sending, and the success message repeats the exact
  email + password that were saved.
- **Sign out** calls `queryClient.clear()` in `onSettled` and then navigates to that role's own
  entry (`/admin`, the module desk, or `/`). Clearing only the one current-user key left other
  cached queries live, which is why the old sign-out needed a manual refresh.
- `Protected` trusts **only** the session for its own role — it no longer falls back to
  `useAdminSession()`, and on failure it sends you to that workspace's sign-in rather than to
  another role's dashboard. `Home` likewise only redirects a *student* session. Together these
  stop a lingering Supabase admin session from hijacking the student or module-owner entry.
- `workspaceRole('/')` resolves to **student**: the entry page carries the student sign-in form, and
  without a hint `/auth/me` would fall back to whichever session existed (admin first) and bounce
  the student to the admin dashboard.

- **Admin password semantics**: `admins` table is a *mapping* target for the Supabase flow; the real
  admin credential is the Supabase `zedkingservice@gmail.com` account. Any admin re-auth MUST go
  through Supabase.
- Teachers have `plain_password` stored in the DB on purpose so the admin can reveal them; do not
  remove it without updating the reveal feature. `GET /admin/teachers` still returns it, so any new
  admin screen must mask it — only `ModuleDetailPage` may reveal it, and only after the Supabase
  admin-password confirmation.
- A module may hold **several** teacher logins. The old `teachers_module_unique` constraint was
  dropped (schema + `alter table teachers drop constraint teachers_module_unique`), so do not
  reintroduce any "one teacher per module" assumption. Isolation is unaffected: teacher routes
  still scope by `req.auth.module`, never by a module in the request body.
- No test suite exists — `typecheck` is the safety net.
- **`announcements.created_by` references `teachers.id`**, so anything written from the admin desk
  must leave it `null` and rely on `author_name`. Do not widen it to admins without a schema change.
- **Course PDFs are uploads, not repo files.** Staff replace them from `/admin/documents` or
  `/teacher/documents`; nothing about them lives in the repo. `public/docs/` was deleted.
- **The document download must stay `Cache-Control: no-store`.** The URL does not change when a
  file is replaced, so a cached response would keep serving the retired PDF. The frontend also
  appends `?v=<updatedAt>` for the same reason — belt and braces.
- **`express.json` is 12mb** because course documents arrive as base64 JSON. Lowering it silently
  breaks uploads of larger PDFs with a 413 rather than a readable message.
- **Copying files out of OneDrive on this machine needs the bytes read, not `Copy-Item`.** The
  Desktop lives under OneDrive and its files are online-only reparse points; a plain copy lands a
  placeholder that disappears. `cp` from Git Bash hydrates and copies properly.
- On this machine `pnpm` has no `.cmd` shim, so package.json scripts that shell out to `pnpm`
  (including the root `typecheck` and `build`) fail with "'pnpm' is not recognized". Run the
  underlying tools directly instead: `./node_modules/.bin/tsc --build` for the libs, then
  `../../node_modules/.bin/tsc -p tsconfig.json --noEmit` in each artifact package, and
  `./node_modules/.bin/drizzle-kit push --config ./drizzle.config.ts` (with `DATABASE_URL` set)
  in `lib/db`.
- `noUnusedLocals` is false in tsconfig.base: dead code won't fail typecheck, but avoid leaving it.
- After any schema change: `pnpm --filter @workspace/db run push`. After any openapi change:
  `pnpm --filter @workspace/api-spec run codegen`.
- The API server must be rebuilt + restarted manually after editing `artifacts/api-server/src`
  (esbuild output is not watched).
- Repo contains `replit.md` (older operating notes) — keep both in sync, this file is the live one.