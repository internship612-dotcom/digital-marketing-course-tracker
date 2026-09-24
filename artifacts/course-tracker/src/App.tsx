import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  getGetCurrentUserQueryKey,
  getListAllAssessmentsQueryKey,
  getListAllAttendanceQueryKey,
  getListStudentsQueryKey,
  getListTeacherStudentsQueryKey,
  getListTeachersQueryKey,
  useCreateStudent,
  useCreateTeacher,
  useDeleteTeacher,
  useGetAdminSummary,
  useGetCurrentUser,
  useListAllAssessments,
  useListAllAttendance,
  useListStudents,
  useListTeacherStudents,
  useListTeachers,
  useLogin,
  useLoginSupabaseAdmin,
  useLogout,
  useUpdateTeacher,
  useUpdateAdminPassword,
  setRoleHintGetter,
  type CurrentUser,
  type Module,
  type Role,
  type Student,
  type Teacher,
} from '@workspace/api-client-react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarCheck2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Eye,
  EyeOff,
  FileText,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import zedkingLogo from './assets/zedking-logo.png';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isAdminEmail, supabase } from '@/lib/supabase';
import { validateStudentEmail } from '@/lib/email-validation';
import type { Session } from '@supabase/supabase-js';

const queryClient = new QueryClient();
const modules: Module[] = ['ai', 'dm', 'sm'];

// Each role has its own session cookie, so admin, module owner and student can be
// signed in side by side. Which one the API resolves depends on this hint, derived
// from the page you are on.
function workspaceRole(pathname: string): Role | null {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = (base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname) || '/';
  if (path.startsWith('/student')) return 'student';
  if (path.startsWith('/teacher')) return 'teacher';
  // Module panels sit at /<module> and /admin/<module>; the rest of /admin is the admin desk.
  if (modules.some((m) => path === `/${m}` || path === `/admin/${m}`)) return 'teacher';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  // The entry page carries the student sign-in form, so resolve it as the student
  // workspace — otherwise /auth/me falls back to whichever session happens to exist.
  if (path === '/') return 'student';
  return null;
}

setRoleHintGetter(() => (typeof window === 'undefined' ? null : workspaceRole(window.location.pathname)));

// The cached "who am I" has to be per workspace too, or navigating from the admin
// desk into a module panel would reuse the admin answer.
function currentUserQueryKey(role: Role | null) {
  return [...getGetCurrentUserQueryKey(), role ?? 'any'];
}

function useCurrentUser() {
  const [location] = useLocation();
  return useGetCurrentUser({ query: { queryKey: currentUserQueryKey(workspaceRole(location)), retry: false } });
}
const moduleNames: Record<Module, string> = { ai: 'AI', dm: 'Digital marketing', sm: 'Social media' };
const moduleShort: Record<Module, string> = { ai: 'AI', dm: 'DM', sm: 'SM' };
const roleRoutes: Record<Role, string> = { admin: '/admin/dashboard', teacher: '/teacher', student: '/student' };
function dashboardPath(role: Role | null | undefined): string {
  return role ? roleRoutes[role] : '/';
}

const adminModules: { key: Module; number: number; name: string; tagline: string }[] = [
  { key: 'ai', number: 1, name: 'Artificial Intelligence', tagline: 'Automation, forecasting, and AI-driven insight across your portfolio.' },
  { key: 'dm', number: 2, name: 'Digital Marketing', tagline: 'Campaigns, reach, and conversions measured in one calm view.' },
  { key: 'sm', number: 3, name: 'Social Media', tagline: 'Presence, engagement, and community growth at a glance.' },
];

// The course PDFs students read. They live in the database, not in the repo, because
// staff replace them from the portal: the file is uploaded once and every module desk,
// the admin and the student then read the same row. One file per (module, kind), so an
// upload silently retires the previous one.
const documentKinds = ['syllabus', 'project_plan', 'project_guidelines'] as const;
type DocumentKind = (typeof documentKinds)[number];
type CourseDocument = {
  module: Module;
  kind: DocumentKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  updatedAt: string;
};

const documentLabels: Record<DocumentKind, { label: string; detail: string }> = {
  syllabus: { label: 'Syllabus', detail: 'The six-month course outline (PDF)' },
  project_plan: { label: 'Project plan', detail: 'What you build, month by month (PDF)' },
  project_guidelines: { label: 'Project guidelines', detail: 'How your work is marked and what to submit (PDF)' },
};

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Downloads go through the caller's own role prefix so the session cookie resolves;
// a plain <a> cannot send the x-ct-role header, and the path is what the API falls
// back to. Cache-busted because staff replace a file in place under the same URL.
function documentHref(scope: 'admin' | 'teacher' | 'student', doc: CourseDocument): string {
  return `/api/${scope}/documents/${doc.module}/${doc.kind}/file?v=${encodeURIComponent(doc.updatedAt)}`;
}

function useCourseDocuments(scope: 'admin' | 'teacher' | 'student') {
  const [docs, setDocs] = useState<CourseDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [token, setToken] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetch(`/api/${scope}/documents`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (!alive) return; if (ok) setDocs(data as CourseDocument[]); else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [scope, token]);
  return { docs, failed, refresh: () => setToken((v) => v + 1) };
}

// One row per document. Opens in a new tab so the student keeps their place in the portal.
function DocLink({ scope, kind, doc }: { scope: 'admin' | 'teacher' | 'student'; kind: DocumentKind; doc?: CourseDocument }) {
  const meta = documentLabels[kind];
  if (!doc) {
    return <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-muted-foreground" data-testid={`doc-${kind}-pending`}>
      <FileText size={18} className="shrink-0" />
      <div className="min-w-0"><p className="text-sm font-semibold">{meta.label}</p><p className="text-xs">Not uploaded yet — it will appear here once the institute adds it.</p></div>
    </div>;
  }
  return <a href={documentHref(scope, doc)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-accent hover:bg-accent/10" data-testid={`doc-${kind}-${doc.module}`}>
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/20 text-primary"><FileText size={17} /></span>
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{meta.label}</p><p className="text-xs text-muted-foreground">{meta.detail}</p></div>
    <ArrowRight size={16} className="shrink-0 text-primary" />
  </a>;
}

function initials(name = 'CourseTracker') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

// The institute wordmark with the product name under it. Stacked rather than side by
// side because the artwork is a ~4:1 lockup — setting "Course Tracker" beside it would
// run off a 256px sidebar and squash the logo to fit. The rule and the tracked caps
// tie the two together and match the label style used across the app.
//
// The artwork is dark blue, red and black on a transparent background, which would all
// but vanish on the navy sidebar — hence the white plate wherever `dark` is set.
// Tinting or inverting it instead would wreck the brand colours.
//
// Sizing is deliberate. The asset is 576x144 — exactly 3x the 192px box `dark` draws it
// in — so a 1x screen gets a clean 3:1 reduction and a 3x phone is pixel-for-pixel. The
// width is what is pinned, not the height: the strapline under "Zed-King" is only a few
// pixels tall once scaled, and that is the first thing to turn to mush if the box is
// sized loosely or the browser is left to downscale the full-size original.
function Logo({ dark = false }: { dark?: boolean; showText?: boolean }) {
  return (
    <Link href="/" className="flex w-fit flex-col items-center gap-1.5 self-start" data-testid="link-logo">
      <img
        src={zedkingLogo}
        alt="Zed-King Group of Institutions"
        width={576}
        height={144}
        className={`h-auto ${dark ? 'w-48 rounded-md bg-white p-2' : 'w-32'}`}
      />
      <span className={`flex w-full items-center gap-2 ${dark ? 'text-accent' : 'text-primary'}`}>
        <span className={`h-px flex-1 ${dark ? 'bg-accent/30' : 'bg-primary/20'}`} />
        <span className="font-mono-ui text-[10px] font-semibold uppercase tracking-[0.26em] whitespace-nowrap">Course Tracker</span>
        <span className={`h-px flex-1 ${dark ? 'bg-accent/30' : 'bg-primary/20'}`} />
      </span>
    </Link>
  );
}

function LoadingScreen({ label = 'Preparing your workspace' }: { label?: string }) {
  return (
    <div className="app-noise grid min-h-[100dvh] place-items-center bg-background p-6">
      <div className="w-full max-w-xs space-y-4">
        <div className="h-10 w-36 animate-pulse rounded-lg bg-muted" />
        <div className="h-3 w-56 animate-pulse rounded bg-muted" />
        <div className="h-2 w-full animate-pulse rounded bg-muted" />
        <p className="font-mono-ui text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-6 text-center" data-testid="state-error">
      <p className="font-display text-lg font-semibold">The record room is quiet.</p>
      <p className="mt-1 text-sm text-muted-foreground">We could not load this view. Try again in a moment.</p>
      {retry && <Button variant="outline" className="mt-4" onClick={retry} data-testid="button-retry"><RefreshCw /> Retry</Button>}
    </div>
  );
}

function EmptyState({ title, detail, icon: Icon = ClipboardCheck }: { title: string; detail: string; icon?: typeof ClipboardCheck }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-border bg-card/55 p-8 text-center" data-testid="state-empty">
      <div><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent/20 text-primary"><Icon size={18} /></span><p className="mt-3 font-display font-semibold">{title}</p><p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{detail}</p></div>
    </div>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}<Input {...props} /></label>;
}

function PasswordField({ label, toggleTestId, ...props }: { label: string; toggleTestId?: string } & React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return <div className="relative">
    <Field label={label} {...props} type={show ? 'text' : 'password'} className="pr-9" />
    <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-[34px] rounded p-1 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-label={show ? 'Hide password' : 'Show password'} data-testid={toggleTestId}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  </div>;
}

function AuthLayout({ children, eyebrow }: { children: ReactNode; eyebrow: string }) {
  return (
    <div className="app-noise min-h-[100dvh] bg-background lg:grid lg:grid-cols-[minmax(320px,0.85fr)_1.15fr]">
      <aside className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-[32px] border-accent/20" />
        <div className="absolute -bottom-20 -left-12 h-56 w-56 rounded-full border-[24px] border-accent/10" />
        <Logo dark />
        <div className="relative max-w-sm pb-8">
          <p className="font-mono-ui text-xs uppercase tracking-[0.22em] text-accent">Daily academic control room</p>
          <h1 className="mt-5 font-display text-5xl font-bold leading-[0.96]">Everyone's progress, one place.</h1>
          <p className="mt-6 max-w-xs text-sm leading-6 text-sidebar-foreground/70">One reliable place for teaching records, attendance, and the small signals that make progress visible.</p>
        </div>
        <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">DIGITAL MARKETING WITH AI</p>
      </aside>
      <main className="flex min-h-[100dvh] items-center justify-center p-5 sm:p-10"><div className="w-full max-w-md">{children}</div></main>
    </div>
  );
}

type NavChild = { href: string; label: string; icon: typeof Users };
type NavItem = NavChild & { children?: NavChild[] };

function Shell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openItem, setOpenItem] = useState('');
const nav: NavItem[] = user.role === 'admin'
  ? [
      { href: '/admin/dashboard', label: 'Admin dashboard', icon: LayoutDashboard },
      { href: '/admin/students', label: 'Add student', icon: Users, children: [{ href: '/admin/students/enrolled', label: 'Student list', icon: UserCheck }] },
      { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
      { href: '/admin/documents', label: 'Course files', icon: FileText },
    ]
  : user.role === 'teacher'
    ? [
        { href: `/admin/${user.module ?? 'ai'}`, label: 'Module desk', icon: ClipboardCheck },
        { href: '/teacher/add-student', label: 'Add student', icon: Users, children: [{ href: '/teacher/students', label: 'Student list', icon: UserCheck }] },
        { href: '/teacher/attendance', label: 'Mark attendance', icon: CalendarCheck2 },
        { href: '/teacher/announcements', label: 'Announcements', icon: Megaphone },
        { href: '/teacher/documents', label: 'Course files', icon: FileText },
      ]
    : [
        { href: '/student/profile', label: 'My profile', icon: UserRound },
        { href: '/student', label: 'My progress', icon: BarChart3 },
        { href: '/student/modules', label: 'Module information', icon: BookOpen },
        { href: '/student/project', label: 'Project', icon: ClipboardCheck },
        { href: '/student/announcements', label: 'Announcements', icon: Megaphone },
      ];
  const signOut = () => {
    const finish = (destination: string) => {
      queryClient.clear();
      setLocation(destination);
    };
    if (user.role === 'admin') {
      logout.mutate(undefined, {
        onSettled: () => { void supabase.auth.signOut().finally(() => finish('/admin')); },
      });
    } else {
      logout.mutate(undefined, { onSettled: () => finish(user.role === 'teacher' ? `/admin/${user.module ?? 'ai'}` : '/') });
    }
  };
  return <div className="app-noise min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar p-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between"><Logo dark /><button className="rounded-md p-2 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-menu"><X size={18} /></button></div>
      <div className="mt-12"><p className="font-mono-ui text-[10px] uppercase tracking-[0.22em] text-sidebar-foreground/45">Workspace</p><nav className="mt-3 grid gap-1">{nav.map((item) => {
         const childOpen = openItem === item.href || location === item.href || (item.children?.some((child) => location.startsWith(child.href)) ?? false);
         return <div key={item.href} onMouseEnter={() => setOpenItem(item.href)} onMouseLeave={() => setOpenItem((v) => (v === item.href ? '' : v))} onFocus={() => setOpenItem(item.href)} onBlur={() => setOpenItem((v) => (v === item.href ? '' : v))}>
           <Link href={item.href} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" data-testid={`link-nav-${user.role}`}><item.icon size={17} />{item.label}</Link>
           {item.children && childOpen && <div className="mt-1 grid gap-1 pl-6">{item.children.map((child) => <Link key={child.href} href={child.href} onClick={() => setMobileOpen(false)} className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent px-3 py-2 text-sm font-semibold text-sidebar-accent-foreground ring-1 ring-sidebar-border transition-colors hover:bg-accent hover:text-primary" data-testid={`link-subnav-${user.role}`}><child.icon size={15} />{child.label}</Link>)}</div>}
         </div>;
       })}</nav></div>
       <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
         {user.role === 'admin' && <Link href="/admin/settings" onClick={() => setMobileOpen(false)} className="mb-3 flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-sm font-semibold text-sidebar-accent-foreground ring-1 ring-sidebar-border transition-colors hover:bg-accent hover:text-primary" data-testid="link-admin-settings"><Settings size={15} /> Settings</Link>}
         <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-xs font-bold text-primary">{user.role === 'admin' ? 'A' : initials(user.displayName)}</span><div className="min-w-0"><p className="truncate text-sm font-semibold" data-testid="text-current-user">{user.role === 'admin' ? 'Admin' : user.displayName}</p>{user.role === 'teacher' && user.module && <p className="font-mono-ui text-[10px] uppercase tracking-wider text-sidebar-foreground/55" data-testid="text-current-module">{moduleShort[user.module]}</p>}</div></div>
         <button onClick={signOut} className="mt-4 flex w-full items-center gap-2 rounded-md px-1 text-xs text-sidebar-foreground/55 hover:text-accent" data-testid="button-logout"><LogOut size={14} /> Sign out</button>
       </div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-30 bg-primary/30 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu overlay" data-testid="button-overlay-menu" />}
    <div className="lg:pl-64"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur sm:px-8"><button className="rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-menu"><Menu size={20} /></button><div className="lg:hidden"><Logo /></div><div className="ml-auto flex items-center gap-3"><span className="hidden font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:block">Institute desk / 01</span><span className="h-2 w-2 rounded-full bg-accent" title="Workspace connected" /></div></header><main className="mx-auto max-w-[1500px] p-5 sm:p-8">{children}</main></div>
  </div>;
}

function PageHeader({ kicker, title, detail, action }: { kicker: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.22em] text-primary">{kicker}</p><h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl" data-testid="text-page-title">{title}</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">{detail}</p></div>{action}</div>;
}

function StatCard({ label, value, detail, icon: Icon, accent = false }: { label: string; value: string | number; detail: string; icon: typeof Users; accent?: boolean }) {
  return <div className={`rounded-xl border p-5 ${accent ? 'border-accent/40 bg-accent/15' : 'border-border bg-card'}`}><div className="flex items-center justify-between"><span className={`grid h-9 w-9 place-items-center rounded-lg ${accent ? 'bg-accent text-primary' : 'bg-muted text-primary'}`}><Icon size={17} /></span><span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span></div><p className="mt-7 font-display text-4xl font-bold" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function AdminModulesPage() {
  return <>
    <PageHeader kicker="Admin / module reports" title="Pick a module." detail="Open a live report for any module — cohort size, register coverage, and the month's projects. Attendance and marks are uploaded from each module's panel desk." />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {adminModules.map((m) => (
        <Link key={m.key} href={`/admin/module/${m.key}`} className="group flex flex-col rounded-xl border border-border bg-card p-6 transition hover:border-accent/60 hover:shadow-sm" data-testid={`card-module-${m.key}`}>
          <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Module {m.number}</span>
          <h2 className="mt-3 font-display text-2xl font-bold leading-tight">{m.name}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{m.tagline}</p>
          <span className="mt-6 inline-flex w-fit items-center gap-1.5 rounded-full bg-muted px-3 py-1 font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground group-hover:text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{moduleShort[m.key]} report</span>
        </Link>
      ))}
    </div>
  </>;
}

function AdminModuleReportPage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as Module;
  const meta = adminModules.find((m) => m.key === moduleKey);
  const [month, setMonth] = useState(1);
  const [summary, setSummary] = useState<{ totalStudents: number; marked: number; expected: number; pending: number; assessmentMarked: number; projects: { cycle: number; marked: number }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/modules/${moduleKey}/attendance/summary?month=${month}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setSummary(data); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [moduleKey, month]);
  if (!meta) return <><PageHeader kicker="Admin / module reports" title="Module not found." detail="That module does not exist." /></>;
  const total = summary?.totalStudents ?? 0;
  const expected = summary?.expected ?? 0;
  const projects = summary?.projects ?? [];
  const projectsMeta = projects.map((p, i) => {
    const status = total > 0 && p.marked === total ? 'Submitted' : p.marked > 0 ? 'Partial' : 'Pending';
    return { ...p, index: i + 1, status };
  });
  return <>
    <PageHeader kicker={`Admin / ${moduleShort[moduleKey]} report`} title={`${meta.name}`} detail="Live status for this module — cohort size, register coverage, and the month's projects." action={<label className="grid gap-1.5 text-sm font-medium">Month<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-report-month">{[1, 2, 3, 4, 5, 6].map((m) => <option key={m} value={m}>Month {m}</option>)}</select></label>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Students" value={total} detail="enrolled in this module" icon={Users} accent /><StatCard label="Attendance marked" value={summary ? `${summary.marked}/${expected}` : '—'} detail="records captured this month" icon={CalendarCheck2} /><StatCard label="Attendance pending" value={summary?.pending ?? '—'} detail="records yet to be filled" icon={Clock} /><StatCard label="Project entries" value={summary?.assessmentMarked ?? '—'} detail="marks entered this month" icon={ClipboardCheck} /></div>
    <section className="mt-8 rounded-xl border border-border bg-card p-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">This month</p><h2 className="mt-1 font-display text-2xl font-bold">Projects status</h2><p className="mt-2 text-sm text-muted-foreground">Whether each of the month's two projects has been submitted by the module owner.</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2">{summary === null || !summary ? [1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />) : projectsMeta.map((p) => <div key={p.cycle} className="rounded-xl border border-border p-5" data-testid={`project-${p.index}`}><div className="flex items-center justify-between"><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Project {p.index}</p><span className={`rounded-full px-2.5 py-1 font-mono-ui text-[10px] ${p.status === 'Submitted' ? 'bg-accent/20 text-primary' : p.status === 'Partial' ? 'bg-muted text-foreground' : 'bg-destructive/10 text-destructive'}`}>{p.status}</span></div><h3 className="mt-2 font-display text-xl font-bold">Cycle {p.cycle}</h3><p className="mt-1 text-sm text-muted-foreground">{p.marked} of {total} students submitted</p></div>)}</div></section>
  </>;
}

// Read-only summary. Creating, revealing, changing and deleting a module login
// all happen on the module page, gated behind the admin's own password.
function OwnerLoginCard({ m, owners }: { m: (typeof adminModules)[number]; owners: Teacher[] }) {
  return <div className="rounded-xl border border-border bg-card p-5" data-testid={`card-panel-login-${m.key}`}>
    <div className="flex items-center justify-between">
      <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">{moduleShort[m.key]} desk</p>
      <span className={`rounded-full px-2.5 py-1 font-mono-ui text-[10px] ${owners.length ? 'bg-accent/20 text-primary' : 'bg-muted text-muted-foreground'}`} data-testid={`status-owner-${m.key}`}>{owners.length ? `${owners.length} login${owners.length === 1 ? '' : 's'}` : 'No login yet'}</span>
    </div>
    <h3 className="mt-2 font-display text-xl font-bold">{moduleNames[m.key]}</h3>
    {owners.length ? (
      <div className="mt-3 grid gap-2">
        {owners.map((owner) => (
          <div key={owner.id} className="space-y-1 rounded-lg bg-muted/60 p-3 font-mono-ui text-xs" data-testid={`panel-login-${m.key}-${owner.id}`}>
            <p className="truncate font-sans text-sm font-semibold" data-testid={`text-owner-name-${m.key}-${owner.id}`}>{owner.displayName || owner.username}</p>
            <p className="truncate">User ID: <span className="font-bold text-foreground" data-testid={`text-owner-username-${m.key}-${owner.id}`}>{owner.username}</span></p>
            <p>Password: <span className="font-bold text-foreground" data-testid={`text-owner-password-${m.key}-${owner.id}`}>••••••••</span></p>
          </div>
        ))}
      </div>
    ) : (
      <p className="mt-3 text-sm text-muted-foreground">This module has no teacher login yet.</p>
    )}
    <Link href={`/admin/module/${m.key}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline" data-testid={`link-manage-login-${m.key}`}>{owners.length ? 'View or edit logins' : 'Create login'} <ArrowRight size={15} /></Link>
    <p className="mt-2 text-xs text-muted-foreground">Passwords are only shown on the module page, after your admin password.</p>
  </div>;
}

function AdminPanelLoginsPage() {
  const teachers = useListTeachers();
  const ownersFor = (module: Module) => (teachers.data ?? []).filter((t) => t.module === module);
  return <>
    <PageHeader kicker="Admin / panel access" title="Create panel logins yourself." detail="Logins are created from each module's own page. A module can hold several, and each owner can only open their own module desk." />
    <div className="grid gap-4 lg:grid-cols-3">{adminModules.map((m) => <OwnerLoginCard key={m.key} m={m} owners={ownersFor(m.key)} />)}</div>
  </>;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return err instanceof Error ? err.message : fallback;
}

function ModuleDetailPage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as Module;
  const meta = adminModules.find((m) => m.key === moduleKey);
  const teachers = useListTeachers();
  const create = useCreateTeacher();
  const update = useUpdateTeacher();
  const remove = useDeleteTeacher();
  const adminSession = useAdminSession();

  const [showForm, setShowForm] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [form, setForm] = useState({ displayName: '', username: '', password: '' });
  const [justCreated, setJustCreated] = useState<{ displayName: string; username: string; password: string } | null>(null);
  const [justCreatedShown, setJustCreatedShown] = useState(false);
  const [revealedIds, setRevealedIds] = useState<number[]>([]);
  const [pwdEditId, setPwdEditId] = useState<number | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [newPwdShown, setNewPwdShown] = useState(false);
  const [pending, setPending] = useState<{ type: 'reveal' | 'delete' | 'password'; teacher: Teacher } | null>(null);
  const [confirmPwd, setConfirmPwd] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const moduleTeachers = (teachers.data ?? []).filter((t) => t.module === moduleKey);
  const designation = `${moduleShort[moduleKey] ?? ''} Instructor`;
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getListTeachersQueryKey() }); };
  const closePwdEdit = () => { setPwdEditId(null); setNewPwd(''); setNewPwdShown(false); };

  // Seeing a password, changing one and deleting a login all go through the
  // admin's own Supabase credentials — `admins.password_hash` is a stale seed hash.
  const verifyAdmin = () => {
    if (!pending || !confirmPwd || !adminSession?.email) return;
    const target = pending.teacher;
    const action = pending.type;
    setConfirmBusy(true); setConfirmError('');
    void supabase.auth.signInWithPassword({ email: adminSession.email, password: confirmPwd })
      .then(({ data, error: authError }) => {
        if (authError || !data.user) throw new Error('The admin password is incorrect.');
        setError(''); setSuccess('');
        if (action === 'reveal') {
          setRevealedIds((ids) => (ids.includes(target.id) ? ids : [...ids, target.id]));
        } else if (action === 'password') {
          setPwdEditId(target.id); setNewPwd(''); setNewPwdShown(false);
        } else {
          remove.mutate({ id: target.id }, {
            onSuccess: () => {
              refresh();
              setRevealedIds((ids) => ids.filter((id) => id !== target.id));
              setPwdEditId((id) => (id === target.id ? null : id));
              setJustCreated((jc) => (jc && jc.username === target.username ? null : jc));
              setSuccess(`Login for ${target.displayName || target.username} deleted.`);
            },
            onError: (err) => setError(apiErrorMessage(err, 'Could not delete this login.')),
          });
        }
        setConfirmPwd(''); setConfirmError(''); setPending(null);
      })
      .catch((err) => setConfirmError(err instanceof Error ? err.message : 'The admin password is incorrect.'))
      .finally(() => setConfirmBusy(false));
  };

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    const payload = { username: form.username.trim(), password: form.password, displayName: form.displayName.trim(), module: moduleKey };
    create.mutate({ data: payload }, {
      onSuccess: () => {
        refresh();
        setJustCreated({ displayName: payload.displayName, username: payload.username, password: payload.password });
        setJustCreatedShown(false);
        setForm({ displayName: '', username: '', password: '' });
        setShowForm(false);
        setShowPwd(false);
        setSuccess('Teacher login created.');
      },
      onError: (err) => setError(apiErrorMessage(err, 'Could not create login.')),
    });
  };

  const handleChangePassword = (e: FormEvent, t: Teacher) => {
    e.preventDefault();
    setError(''); setSuccess('');
    update.mutate({ id: t.id, data: { password: newPwd } }, {
      onSuccess: () => {
        refresh();
        setRevealedIds((ids) => ids.filter((id) => id !== t.id));
        closePwdEdit();
        setSuccess(`Password updated for ${t.displayName || t.username}.`);
      },
      onError: (err) => setError(apiErrorMessage(err, 'Could not update the password.')),
    });
  };

  if (!meta) return <PageHeader kicker="Admin / module detail" title="Module not found." detail="That module does not exist." />;

  return <>
    <PageHeader kicker="Admin / module detail" title={meta.name} detail={`Manage and oversee the ${meta.name.toLowerCase()} module.`} />
    {error && <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="banner-module-error">{error}</div>}
    {success && <div className="mb-4 rounded-md bg-accent/10 px-4 py-3 text-sm text-primary" data-testid="banner-module-success">{success}</div>}

    {/* Profiles only — no credentials here. Those live in the login section below. */}
    <section className="rounded-xl border border-border bg-card p-6" data-testid="teacher-profile-block">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Module team</p>
          <h2 className="mt-1 font-display text-2xl font-bold">Instructors</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">Who teaches the {moduleShort[moduleKey]} module.</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono-ui text-[10px] text-muted-foreground" data-testid="count-module-teachers">{moduleTeachers.length} instructor{moduleTeachers.length === 1 ? '' : 's'}</span>
      </div>

      {teachers.isLoading ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{[1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : moduleTeachers.length === 0 ? (
        <div className="mt-5"><EmptyState title="Not assigned yet" detail="Create the first login for this module below." icon={GraduationCap} /></div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {moduleTeachers.map((t) => {
            const name = t.displayName || t.username;
            return <div key={t.id} className="flex items-center gap-4 rounded-xl border border-border p-4" data-testid={`row-module-teacher-${t.id}`}>
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent font-display text-lg font-bold text-primary">{initials(name)}</span>
              <div className="min-w-0">
                <p className="truncate text-sm"><span className="text-muted-foreground">Name: </span><span className="font-display text-lg font-bold" data-testid={`text-teacher-name-${t.id}`}>{name}</span></p>
                <p className="mt-0.5 truncate text-sm"><span className="text-muted-foreground">Designation: </span><span className="font-semibold text-primary" data-testid={`text-teacher-designation-${t.id}`}>{designation}</span></p>
              </div>
            </div>;
          })}
        </div>
      )}
    </section>

    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Login access</p>
          <h2 className="mt-1 font-display text-2xl font-bold">Teacher logins</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">Pick any name, user ID and password. Seeing a password, changing it or deleting a login asks for your admin password.</p>
        </div>
        {!showForm && <Button onClick={() => { setForm({ displayName: '', username: '', password: '' }); setShowForm(true); setShowPwd(false); }} data-testid="button-create-login"><Plus size={16} /> Create Login</Button>}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mt-5 grid max-w-lg gap-4 border-t border-border pt-5" data-testid="form-create-login">
          <Field label="Name" value={form.displayName} onChange={(e) => setForm((v) => ({ ...v, displayName: e.target.value }))} placeholder="e.g. Ajay" minLength={2} required data-testid="input-login-name" />
          <Field label="User ID" value={form.username} onChange={(e) => setForm((v) => ({ ...v, username: e.target.value }))} placeholder="e.g. ajay.ai" minLength={3} required data-testid="input-login-username" />
          <div className="relative">
            <Field label="Password" type={showPwd ? 'text' : 'password'} value={form.password} onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))} minLength={6} required data-testid="input-login-password" />
            <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-2 top-[34px] rounded p-1 text-muted-foreground hover:text-foreground" tabIndex={-1} data-testid="button-toggle-pwd">
              {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Designation is set automatically: <span className="font-semibold text-primary">{designation}</span></p>
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending} data-testid="button-submit-login">{create.isPending ? 'Saving…' : 'Create Login'}</Button>
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setForm({ displayName: '', username: '', password: '' }); setShowPwd(false); }} data-testid="button-cancel-login">Cancel</Button>
          </div>
        </form>
      )}

      {justCreated && (
        <div className="mt-5 rounded-lg border border-accent/50 bg-accent/10 p-4" data-testid="banner-created-creds">
          <div className="flex items-start justify-between gap-3">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Login created — save these details now</p>
            <button type="button" onClick={() => { setJustCreated(null); setJustCreatedShown(false); }} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss" data-testid="button-dismiss-created"><X size={14} /></button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="text-sm"><span className="text-muted-foreground">Name: </span><span className="font-semibold" data-testid="created-name">{justCreated.displayName}</span></div>
            <div className="truncate text-sm"><span className="text-muted-foreground">User ID: </span><span className="font-mono-ui font-semibold" data-testid="created-username">{justCreated.username}</span></div>
            <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Password: </span>
              <span className="font-mono-ui font-semibold" data-testid="created-password">{justCreatedShown ? justCreated.password : '••••••••'}</span>
              <button type="button" onClick={() => setJustCreatedShown((v) => !v)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={justCreatedShown ? 'Hide password' : 'See password'} data-testid="button-eye-created">{justCreatedShown ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </div>
        </div>
      )}

      {!teachers.isLoading && moduleTeachers.length > 0 && (
        <div className="mt-5 grid gap-3 border-t border-border pt-5">
          {moduleTeachers.map((t) => {
            const isRevealed = revealedIds.includes(t.id);
            const name = t.displayName || t.username;
            return <div key={t.id} className="rounded-xl border border-border p-4" data-testid={`row-module-login-${t.id}`}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <p className="min-w-[8rem] truncate text-sm font-semibold" data-testid={`text-login-owner-${t.id}`}>{name}</p>
                <p className="truncate font-mono-ui text-xs"><span className="text-muted-foreground">User ID: </span><span className="font-bold text-foreground" data-testid={`text-teacher-username-${t.id}`}>{t.username}</span></p>
                <p className="flex items-center gap-2 font-mono-ui text-xs"><span className="text-muted-foreground">Password: </span>
                  <span className="font-bold text-foreground" data-testid={`text-teacher-password-${t.id}`}>{isRevealed ? (t.plainPassword ?? '—') : '••••••••'}</span>
                  <button type="button" onClick={() => { if (isRevealed) { setRevealedIds((ids) => ids.filter((id) => id !== t.id)); return; } setPending({ type: 'reveal', teacher: t }); }} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={isRevealed ? 'Hide password' : 'See password'} data-testid={`button-eye-teacher-${t.id}`}>{isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </p>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { if (pwdEditId === t.id) { closePwdEdit(); return; } setPending({ type: 'password', teacher: t }); }} disabled={update.isPending} data-testid={`button-change-password-${t.id}`}><KeyRound size={14} /> Change password</Button>
                  <Button variant="outline" size="sm" onClick={() => setPending({ type: 'delete', teacher: t })} disabled={remove.isPending} data-testid={`button-delete-teacher-${t.id}`}><Trash2 size={14} /> Delete</Button>
                </div>
              </div>

              {pwdEditId === t.id && (
                <form onSubmit={(e) => handleChangePassword(e, t)} className="mt-4 grid max-w-sm gap-3 border-t border-border pt-4" data-testid={`form-change-password-${t.id}`}>
                  <div className="relative">
                    <Field label="New password" type={newPwdShown ? 'text' : 'password'} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} minLength={6} autoFocus required data-testid={`input-new-password-${t.id}`} />
                    <button type="button" onClick={() => setNewPwdShown((v) => !v)} className="absolute right-2 top-[34px] rounded p-1 text-muted-foreground hover:text-foreground" tabIndex={-1} data-testid={`button-toggle-new-password-${t.id}`}>
                      {newPwdShown ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={update.isPending || newPwd.length < 6} data-testid={`button-save-password-${t.id}`}>{update.isPending ? 'Saving…' : 'Save password'}</Button>
                    <Button type="button" size="sm" variant="outline" onClick={closePwdEdit} data-testid={`button-cancel-password-${t.id}`}>Cancel</Button>
                  </div>
                </form>
              )}
            </div>;
          })}
        </div>
      )}
    </section>

    {pending && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-primary/30 p-4" data-testid="modal-admin-confirm">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Admin verification</p>
          <h3 className="mt-1 font-display text-xl font-bold">{pending.type === 'reveal' ? 'See teacher password' : pending.type === 'password' ? 'Change teacher password' : 'Delete teacher login'}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{pending.type === 'reveal' ? `Enter your admin password to see the password for ${pending.teacher.displayName || pending.teacher.username}.` : pending.type === 'password' ? `Enter your admin password to set a new password for ${pending.teacher.displayName || pending.teacher.username}.` : `This permanently removes the login for ${pending.teacher.displayName || pending.teacher.username}. Enter your admin password to confirm.`}</p>
          <form onSubmit={(e) => { e.preventDefault(); verifyAdmin(); }} className="mt-4 grid gap-3">
            <PasswordField label="Admin password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoFocus required data-testid="input-admin-confirm-password" toggleTestId="button-toggle-admin-confirm-pwd" />
            {confirmError && <p className="text-xs text-destructive" data-testid="status-admin-confirm-error">{confirmError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setConfirmPwd(''); setConfirmError(''); setPending(null); }} disabled={confirmBusy} data-testid="button-cancel-confirm">Cancel</Button>
              <Button type="submit" size="sm" variant={pending.type === 'delete' ? 'destructive' : 'default'} disabled={confirmBusy || !confirmPwd} data-testid="button-submit-confirm">{confirmBusy ? 'Verifying…' : pending.type === 'delete' ? 'Delete login' : 'Confirm'}</Button>
            </div>
          </form>
        </div>
      </div>
    )}

    <ModuleStatusSection moduleKey={moduleKey} />
  </>;
}

function ModuleStatusSection({ moduleKey }: { moduleKey: Module }) {
  const [month, setMonth] = useState(1);
  const [summary, setSummary] = useState<{ studentsMarked: number; studentsPending: number; assessmentMarked: number; totalStudents: number; projects: { cycle: number; marked: number }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    setSummary(null);
    fetch(`/api/admin/modules/${moduleKey}/attendance/summary?month=${month}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setSummary(data); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [moduleKey, month]);

  // "How many students are still missing" is the question this section answers, so
  // say it in students — not a bare Updated/Pending badge.
  const total = summary?.totalStudents ?? 0;
  const attendanceDone = summary?.studentsMarked ?? 0;
  const projects = summary?.projects ?? [];
  // A student counts as done for the month once both of its projects carry a mark.
  const assessmentDone = projects.length ? Math.min(...projects.map((p) => p.marked)) : 0;

  const Card = ({ label, done, total: cardTotal, detail, icon: Icon, testId }: { label: string; done: number; total: number; detail: string; icon: typeof Users; testId: string }) => {
    const pending = Math.max(0, cardTotal - done);
    const percent = cardTotal === 0 ? 0 : Math.round((done / cardTotal) * 100);
    return <div className="rounded-xl border border-border p-5" data-testid={testId}>
      <div className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-primary"><Icon size={17} /></span>
        <span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      {summary == null ? <div className="mt-6 h-16 animate-pulse rounded bg-muted" /> : <>
        <p className="mt-5 font-display text-3xl font-bold">{done}<span className="text-xl text-muted-foreground"> of {cardTotal}</span><span className="ml-2 text-sm font-semibold text-muted-foreground">students</span></p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold text-primary"><Check size={13} /> {done} uploaded</span>
          <span className={`inline-flex items-center gap-1.5 font-semibold ${pending > 0 ? 'text-destructive' : 'text-muted-foreground'}`}><Clock size={13} /> {pending} not uploaded</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </>}
    </div>;
  };

  return <section className="mt-6 rounded-xl border border-border bg-card p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Status summary</p>
        <h2 className="mt-1 font-display text-2xl font-bold">Attendance &amp; assessment</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">How many students this module has uploaded for, and how many are still missing, in month {month}.</p>
      </div>
      <label className="grid gap-1.5 text-sm font-medium">Month<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-status-month">{[1, 2, 3, 4, 5, 6].map((m) => <option key={m} value={m}>Month {m}</option>)}</select></label>
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Card label="Attendance" done={attendanceDone} total={total} detail={`Students with at least one week of month ${month} in the register.`} icon={CalendarCheck2} testId="status-attendance" />
      <Card label="Assessment" done={assessmentDone} total={total} detail={projects.length ? projects.map((p) => `Project ${((p.cycle - 1) % 2) + 1}: ${p.marked} of ${total}`).join(' · ') : 'No projects for this month yet.'} icon={ClipboardCheck} testId="status-assessment" />
    </div>
  </section>;
}

function ProgressCard({ label, done, pending, doneLabel, pendingLabel, icon: Icon, testId }: { label: string; done: number; pending: number; doneLabel: string; pendingLabel: string; icon: typeof Users; testId: string }) {
  const total = done + pending;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return <div className="rounded-xl border border-border bg-card p-5" data-testid={testId}>
    <div className="flex items-center justify-between">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-primary"><Icon size={17} /></span>
      <span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
    <p className="mt-6 font-display text-4xl font-bold">{done}<span className="text-2xl text-muted-foreground"> / {total}</span></p>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} /></div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold text-primary"><Check size={13} /> {done} {doneLabel}</span>
      <span className={`inline-flex items-center gap-1.5 font-semibold ${pending > 0 ? 'text-destructive' : 'text-muted-foreground'}`}><Clock size={13} /> {pending} {pendingLabel}</span>
    </div>
  </div>;
}

function TeacherPage({ user }: { user: CurrentUser }) {
  const students = useListTeacherStudents();
  const [overview, setOverview] = useState<{ totalStudents: number; attendanceMarked: number; attendancePending: number; assessmentMarked: number; assessmentPending: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/teacher/overview').then((res) => res.json().then((data) => ({ ok: res.ok, data }))).then(({ ok, data }) => { if (alive && ok) setOverview(data as typeof overview); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const total = overview?.totalStudents ?? students.data?.length ?? 0;
  return <>
    <PageHeader kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`} title={`Keep ${user.module ? moduleShort[user.module] : 'your'} current.`} detail="Where this module stands right now. Fill today's register from Mark attendance in the side panel, or open the student list to upload project marks." action={<Link href="/teacher/students" className="flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/15 px-3 py-2 text-xs font-semibold text-primary hover:bg-accent/30" data-testid="link-open-student-list"><Users size={15} /> Open student list</Link>} />
    <div className="grid gap-4 lg:grid-cols-3" data-testid="module-desk-summary">
      <div className="rounded-xl border border-accent/40 bg-accent/15 p-5" data-testid="card-total-students">
        <div className="flex items-center justify-between">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary"><Users size={17} /></span>
          <span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">Total students</span>
        </div>
        <p className="mt-6 font-display text-4xl font-bold">{total}</p>
        <p className="mt-3 text-xs text-muted-foreground">on the {moduleShort[user.module ?? 'ai']} roster</p>
      </div>
      <ProgressCard label="Attendance" done={overview?.attendanceMarked ?? 0} pending={overview?.attendancePending ?? 0} doneLabel="marked" pendingLabel="not marked yet" icon={CalendarCheck2} testId="card-attendance" />
      <ProgressCard label="Assessments" done={overview?.assessmentMarked ?? 0} pending={overview?.assessmentPending ?? 0} doneLabel="marks uploaded" pendingLabel="no marks yet" icon={ClipboardCheck} testId="card-assessments" />
    </div>
    <p className="mt-4 text-xs text-muted-foreground">Counts every student this module has recorded at least once. Week-by-week and project-by-project detail is in the <Link href="/teacher/students" className="font-semibold text-primary hover:underline">student list</Link>.</p>
  </>;
}

const joinedOn = (value: string) => String(value ?? '').slice(0, 10);

// ---------------------------------------------------------------- calendar grid
// The register picks a real calendar date; the API turns it into that student's own
// week number, because week 1 is the week each student joined.
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}
// Mon = 0 … Sun = 6. Sunday is not a teaching day, so it has no attendance column.
function dayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}
function monthGrid(view: Date): (Date | null)[] {
  const year = view.getUTCFullYear();
  const month = view.getUTCMonth();
  const first = utcDay(year, month, 1);
  const lead = dayIndex(first);
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(utcDay(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ------------------------------------------------------------- day register (page)
// Today in the viewer's own calendar. The page always opens on it, so nobody has to
// change the date or the month from one day to the next.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()];
  return `${weekday}, ${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

type RegisterRow = Student & { week: number | null; eligible: boolean; present: boolean; recorded: boolean; locked: boolean };
type Mark = 'present' | 'absent';

// Two checkboxes per student: P ticks green, A ticks red, and a row with neither
// ticked stays grey and is left exactly as it was. They are always drawn, even when
// the date is out of range, so the column reads the same on every row.
function MarkCheckboxes({ row, mark, disabled, reason, onPick }: { row: RegisterRow; mark: Mark | undefined; disabled: boolean; reason: string; onPick: (next: Mark | undefined) => void }) {
  const box = (kind: Mark, letter: string, on: string) => {
    const checked = mark === kind;
    return <label
      className={`inline-flex select-none items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-bold transition ${disabled ? 'cursor-not-allowed border-border bg-muted/50 text-muted-foreground/60' : checked ? on : 'cursor-pointer border-border bg-muted text-muted-foreground hover:border-foreground/30'}`}
      title={disabled ? reason : `Mark ${row.fullName} ${kind}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => { event.stopPropagation(); onPick(checked ? undefined : kind); }}
        onClick={(event) => event.stopPropagation()}
        className={`h-4 w-4 ${kind === 'present' ? 'accent-emerald-600' : 'accent-red-600'} ${disabled ? '' : 'cursor-pointer'}`}
        aria-label={`${row.fullName} ${kind}`}
        data-testid={`check-${kind}-${row.id}`}
      />
      {letter}
    </label>;
  };
  return <div className="flex flex-col items-end gap-1">
    <div className="flex items-center gap-1.5">
      {box('present', 'P', 'border-emerald-600 bg-emerald-500/15 text-emerald-700')}
      {box('absent', 'A', 'border-destructive bg-destructive/10 text-destructive')}
    </div>
    {disabled && <span className="whitespace-nowrap text-[10px] text-muted-foreground" data-testid={`reason-${row.id}`}>{reason}</span>}
  </div>;
}

function AttendanceRegisterPage({ user }: { user: CurrentUser }) {
  // `today` re-reads the clock so a tab left open overnight rolls onto the new day by
  // itself; `override` only exists for going back and fixing an earlier date.
  const [today, setToday] = useState(todayIso);
  const [override, setOverride] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setToday((v) => (todayIso() === v ? v : todayIso())), 60_000);
    return () => clearInterval(id);
  }, []);
  const date = override ?? today;

  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`/api/teacher/attendance/day?date=${date}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok) { setError('Could not open the register for this date.'); setRows([]); return; }
        const list = data as RegisterRow[];
        setRows(list);
        // Saved rows come back showing what was recorded; the rest start grey.
        setMarks(Object.fromEntries(list
          .filter((r) => r.eligible && r.locked)
          .map((r) => [r.id, r.present ? 'present' : 'absent'] as const)));
      })
      .catch(() => { if (alive) { setError('Could not open the register for this date.'); setRows([]); } });
    return () => { alive = false; };
  }, [date, reloadToken]);

  useEffect(() => { setError(''); setNotice(''); }, [date]);

  const sunday = dayIndex(new Date(`${date}T00:00:00Z`)) > 5;
  const all = rows ?? [];
  const eligible = all.filter((row) => row.eligible);
  const open = eligible.filter((row) => !row.locked);
  const lockedRows = eligible.filter((row) => row.locked);
  const query = search.trim().toLowerCase();
  const shown = all.filter((row) => studentMatches(row, query));
  const presentIds = open.filter((row) => marks[row.id] === 'present').map((row) => row.id);
  const absentIds = open.filter((row) => marks[row.id] === 'absent').map((row) => row.id);
  const untouched = open.length - presentIds.length - absentIds.length;

  const markable = sunday ? 0 : open.length;
  // Bulk controls leave already-saved rows exactly as they are.
  const setAll = (mark: Mark | undefined) => setMarks((v) => {
    const kept = Object.fromEntries(lockedRows.map((row) => [row.id, v[row.id]!]).filter(([, m]) => m));
    return mark ? { ...kept, ...Object.fromEntries(open.map((row) => [row.id, mark])) } : kept;
  });

  const save = () => {
    if (presentIds.length + absentIds.length === 0) { setError('Mark at least one student P or A before saving.'); return; }
    setSaving(true); setError(''); setNotice('');
    fetch('/api/teacher/attendance/day', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, present: presentIds, absent: absentIds }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error('save failed');
        const body = data as { saved: number; locked: number };
        setNotice(`Saved for ${longDate(date)} — ${presentIds.length} present, ${absentIds.length} absent${untouched ? `, ${untouched} left blank` : ''}. Saved rows are now locked.`);
        if (body.locked) setError(`${body.locked} row${body.locked === 1 ? ' was' : 's were'} already saved and left unchanged.`);
        setReloadToken((v) => v + 1);
      })
      .catch(() => setError('Could not save the register. Try again.'))
      .finally(() => setSaving(false));
  };

  return <>
    <PageHeader
      kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`}
      title="Mark attendance"
      detail="Today's register, ready to fill. Tick P for present or A for absent; anything left grey is not recorded either way. Check it before you save — once a row is saved it is locked and cannot be changed."
      action={<Button type="button" onClick={save} disabled={saving || rows == null || sunday || markable === 0} data-testid="button-save-register">{saving ? 'Saving…' : <><Check size={15} /> Save attendance</>}</Button>}
    />

    <section className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-primary"><CalendarCheck2 size={19} /></span>
        <div>
          <p className="font-display text-lg font-bold leading-tight" data-testid="text-register-date">{longDate(date)}</p>
          <p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{override ? 'Earlier date' : 'Today · updates on its own'}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setOverride(shiftIso(date, -1))} className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => setOverride(shiftIso(date, 1))} disabled={date >= today} className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="Next day" data-testid="button-next-day"><ChevronRight size={16} /></button>
        {override && <Button type="button" size="sm" variant="outline" onClick={() => setOverride(null)} data-testid="button-back-to-today">Back to today</Button>}
      </div>
    </section>

    {sunday && <p className="mb-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="status-sunday">Sunday is not a teaching day, so nothing can be recorded against it. The date still moves on to tomorrow by itself.</p>}

    {!sunday && rows != null && all.length > 0 && eligible.length === 0 && <p className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="status-none-eligible">
      Nobody can be marked on {longDate(date)} — every student&apos;s joining date is later than this, so their course has not started yet. Each row below shows the date it opens from.
    </p>}

    {!sunday && rows != null && eligible.length > 0 && open.length === 0 && <p className="mb-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="status-all-locked">
      This register was saved and is closed. Attendance cannot be changed once it has been saved.
    </p>}

    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} />
        <Input className="pl-9" placeholder="Search by name, student ID, contact number or email" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-register" />
      </div>
      <span className="text-xs text-muted-foreground">{shown.length} student{shown.length === 1 ? '' : 's'} shown</span>
    </div>

    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">All students</h2>
        <p className="text-xs text-muted-foreground" data-testid="text-register-tally"><strong className="text-emerald-600">{presentIds.length} present</strong> · <strong className="text-destructive">{absentIds.length} absent</strong> · {untouched} not marked{lockedRows.length ? ` · ${lockedRows.length} already saved` : ''}</p>
      </div>
      {rows == null ? <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
        : shown.length === 0 ? <EmptyState title="No matching students" detail={all.length === 0 ? 'Nobody is enrolled yet.' : 'Try a name, student ID, contact number or email.'} icon={UserRound} />
        : <StudentTable students={shown} testIdPrefix="row-register" actionLabel={<div className="flex flex-col items-end gap-1.5">
            <span>Attendance</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setAll('present')} disabled={sunday || markable === 0} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition hover:border-emerald-600 hover:text-emerald-700 disabled:opacity-40" data-testid="button-all-present">All P</button>
              <button type="button" onClick={() => setAll('absent')} disabled={sunday || markable === 0} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition hover:border-destructive hover:text-destructive disabled:opacity-40" data-testid="button-all-absent">All A</button>
              <button type="button" onClick={() => setAll(undefined)} disabled={sunday || markable === 0} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition hover:border-foreground/40 hover:text-foreground disabled:opacity-40" data-testid="button-clear-marks">Clear</button>
            </div>
          </div>} action={(student) => {
            const row = shown.find((r) => r.id === student.id)!;
            const reason = sunday ? 'Sunday — off day' : !row.eligible ? `Joins ${joinedOn(row.dateOfJoining)}` : row.locked ? 'Saved — locked' : '';
            return <MarkCheckboxes row={row} mark={marks[row.id]} disabled={sunday || !row.eligible || row.locked} reason={reason} onPick={(next) => setMarks((v) => {
              if (!next) { const { [row.id]: _drop, ...rest } = v; return rest; }
              return { ...v, [row.id]: next };
            })} />;
          }} />}
      {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-register-error">{error}</p>}
      {notice && <p className="mt-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-register-success">{notice}</p>}
    </section>
  </>;
}

// Marks now live on the student record, directly under that student's report, so the
// person reading the report can fill the gap they just spotted.
function MarksUpload({ student, module, onSaved }: { student: Student; module: Module | null | undefined; onSaved: () => void }) {
  const [month, setMonth] = useState(1);
  // No project is picked for you — marks are final once saved, so the choice is explicit.
  const [project, setProject] = useState<'' | 1 | 2>('');
  const [marks, setMarks] = useState('');
  const [feedback, setFeedback] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const cycle = project === '' ? null : (month - 1) * 2 + project;

  useEffect(() => {
    if (cycle == null) { setMarks(''); setFeedback(''); setProjectName(''); return; }
    let alive = true;
    setLoading(true); setError('');
    fetch(`/api/teacher/assessments?cycle=${cycle}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok) { setError('Could not load this project.'); return; }
        const record = (data as { studentId: string; marks: number | null; feedback: string | null; projectName: string | null }[]).find((r) => r.studentId === student.id);
        setMarks(record?.marks == null ? '' : String(record.marks));
        setFeedback(record?.feedback ?? '');
        setProjectName(record?.projectName ?? '');
      })
      .catch(() => { if (alive) setError('Could not load this project.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cycle, student.id, reloadToken]);

  // Clear the last save message as soon as a different project is chosen.
  useEffect(() => { setNotice(''); }, [cycle]);

  const save = () => {
    if (cycle == null) { setError('Choose a project first.'); return; }
    setSaving(true); setError(''); setNotice('');
    fetch('/api/teacher/assessments/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycle, records: [{ studentId: student.id, marks: marks === '' ? null : Number(marks), feedback, projectName: projectName.trim() || null }] }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('save failed');
        setNotice(`Saved — month ${month}, project ${project}.`);
        // Read it back so the form shows exactly what is stored, rather than emptying.
        setReloadToken((v) => v + 1);
        onSaved();
      })
      .catch(() => setError('Could not save. Try again.'))
      .finally(() => setSaving(false));
  };

  return <section className="mt-6 rounded-xl border border-border bg-card p-4" data-testid="section-marks-upload">
    <p className="text-xs font-semibold text-primary">{module ? moduleNames[module] : 'Module'}</p>
    <h2 className="mt-1 font-display text-xl font-bold">Upload project marks</h2>
    <p className="mt-1 text-xs text-muted-foreground">Month 1 is {joinedOn(student.dateOfJoining)}, when this student enrolled · two projects a month</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-medium">Month<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-assessment-month">{[1, 2, 3, 4, 5, 6].map((m) => <option key={m} value={m}>Month {m}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-medium">Project<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={project} onChange={(e) => setProject(e.target.value === '' ? '' : Number(e.target.value) as 1 | 2)} data-testid="select-assessment-project"><option value="">Select project</option><option value={1}>Project 1</option><option value={2}>Project 2</option></select></label>
    </div>
    {cycle == null ? <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground" data-testid="status-pick-project">Choose a project to enter its marks.</p>
      : loading ? <div className="mt-4 h-28 animate-pulse rounded-lg bg-muted" /> : <div className="mt-4 grid gap-3">
      <label className="grid gap-1.5 text-sm font-medium">Project name<Input placeholder="e.g. Landing page audit" value={projectName} onChange={(e) => setProjectName(e.target.value)} data-testid="input-assessment-project-name" /></label>
      <label className="grid gap-1.5 text-sm font-medium">Marks<Input type="number" min={0} max={100} placeholder="0 – 100" value={marks} onChange={(e) => setMarks(e.target.value)} data-testid="input-assessment-marks" /></label>
      <label className="grid gap-1.5 text-sm font-medium">Feedback<Textarea rows={3} placeholder="Short feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} data-testid="input-assessment-feedback" /></label>
    </div>}
    {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-marks-error">{error}</p>}
    {notice && <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-marks-success">{notice}</p>}
    <div className="mt-4 flex justify-end">
      <Button type="button" size="sm" onClick={save} disabled={saving || loading || cycle == null} data-testid="button-save-assessment">{saving ? 'Saving…' : 'Save marks'}</Button>
    </div>
  </section>;
}

function Avatar({ photo, name, size = 34, testId, placeholderTestId }: { photo?: string | null; name: string; size?: number; testId?: string; placeholderTestId?: string }) {
  return photo
    ? <img src={photo} alt={name} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} data-testid={testId} />
    : <span className="grid shrink-0 place-items-center rounded-full bg-muted font-bold text-muted-foreground" style={{ width: size, height: size, fontSize: size * 0.34 }} data-testid={placeholderTestId}>{initials(name)}</span>;
}

function StudentAvatar({ student, size = 34 }: { student: Student; size?: number }) {
  return <Avatar photo={student.photo} name={student.fullName} size={size} testId={`photo-${student.id}`} placeholderTestId={`photo-placeholder-${student.id}`} />;
}

// Read-only on purpose: the list reports what has been recorded, and the marking
// itself happens on the module desk (attendance) and the student record (marks).
function StatusIcon({ ok, kind, studentId, pending = 0 }: { ok: boolean; kind: 'attendance' | 'marks'; studentId: string; pending?: number }) {
  const Icon = kind === 'attendance' ? CalendarCheck2 : ClipboardCheck;
  const label = kind === 'attendance'
    ? (ok ? "Today's attendance is done" : "Today's attendance is pending")
    : (ok ? 'Marks up to date' : `${pending} project${pending === 1 ? '' : 's'} pending as of today`);
  return <span
    title={label}
    aria-label={label}
    role="img"
    className={`grid h-9 w-9 place-items-center rounded-full ${ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}
    data-testid={`status-${kind}-${studentId}`}
  ><Icon size={17} /></span>;
}

type RowStatus = { attendance: boolean; marks: boolean; attendancePending: number; marksPending: number };

// One row per student, every field on that row. Wide on purpose — the table scrolls
// sideways rather than wrapping a student onto a second line.
function StudentTable({ students, action, actionLabel = 'Actions', statusFor, onRowClick, testIdPrefix }: { students: Student[]; action: (student: Student) => ReactNode; actionLabel?: ReactNode; statusFor?: (student: Student) => RowStatus; onRowClick?: (student: Student) => void; testIdPrefix: string }) {
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[1420px] text-left text-sm">
      <thead className="border-b border-border text-xs font-semibold text-muted-foreground">
        <tr>
          <th className="whitespace-nowrap pb-4 pr-4">#</th>
          <th className="whitespace-nowrap pb-4 pr-4">Student ID</th>
          <th className="whitespace-nowrap pb-4 pr-4">Photo</th>
          <th className="whitespace-nowrap pb-4 pr-4">Name</th>
          <th className="whitespace-nowrap pb-4 pr-4">Father&apos;s name</th>
          <th className="whitespace-nowrap pb-4 pr-4">Course</th>
          <th className="whitespace-nowrap pb-4 pr-4">Joined</th>
          <th className="whitespace-nowrap pb-4 pr-4">Contact</th>
          <th className="whitespace-nowrap pb-4 pr-4">Email</th>
          {statusFor && <th className="whitespace-nowrap pb-4 pr-4 text-center">Attendance</th>}
          {statusFor && <th className="whitespace-nowrap pb-4 pr-4 text-center">Marks</th>}
          <th className="whitespace-nowrap pb-4 pl-4 text-right">{actionLabel}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {students.map((student, index) => <tr key={student.id} onClick={onRowClick ? () => onRowClick(student) : undefined} className={`align-middle ${onRowClick ? 'group cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/30'}`} data-testid={`${testIdPrefix}-${student.id}`}>
          <td className="whitespace-nowrap py-6 pr-4 text-xs text-muted-foreground">{index + 1}</td>
          <td className="whitespace-nowrap py-6 pr-4 font-mono-ui text-xs text-muted-foreground">{student.id}</td>
          <td className="whitespace-nowrap py-6 pr-4"><StudentAvatar student={student} /></td>
          <td className="whitespace-nowrap py-6 pr-4 font-semibold group-hover:text-primary">{student.fullName}</td>
          <td className="whitespace-nowrap py-6 pr-4 text-xs text-muted-foreground">{student.fathersName}</td>
          <td className="whitespace-nowrap py-6 pr-4 text-xs text-muted-foreground">{student.course}</td>
          <td className="whitespace-nowrap py-6 pr-4 font-mono-ui text-xs text-muted-foreground">{joinedOn(student.dateOfJoining)}</td>
          <td className="whitespace-nowrap py-6 pr-4 text-xs text-muted-foreground">{student.contactNumber}</td>
          <td className="whitespace-nowrap py-6 pr-4 text-xs text-muted-foreground">{student.email}</td>
          {statusFor && <td className="whitespace-nowrap py-6 pr-4"><div className="flex justify-center"><StatusIcon ok={statusFor(student).attendance} pending={statusFor(student).attendancePending} kind="attendance" studentId={student.id} /></div></td>}
          {statusFor && <td className="whitespace-nowrap py-6 pr-4"><div className="flex justify-center"><StatusIcon ok={statusFor(student).marks} pending={statusFor(student).marksPending} kind="marks" studentId={student.id} /></div></td>}
          <td className="whitespace-nowrap py-6 pl-4 text-right"><div className="flex items-center justify-end gap-1.5">{action(student)}</div></td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function studentMatches(student: Student, query: string): boolean {
  if (!query) return true;
  return [student.id, student.fullName, student.fathersName, student.course, joinedOn(student.dateOfJoining), student.contactNumber, student.email]
    .some((value) => String(value ?? '').toLowerCase().includes(query));
}

function StudentSearchBar({ value, onChange, count, testId }: { value: string; onChange: (v: string) => void; count: number; testId: string }) {
  return <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="relative w-full sm:max-w-md">
      <Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} />
      <Input className="pl-9" placeholder="Search by name, student ID, contact number or email" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </div>
    <span className="text-xs text-muted-foreground">{count} student{count === 1 ? '' : 's'} shown</span>
  </div>;
}

function RemarkPanel({ student, base, onClose, onSaved }: { student: Student; base: string; onClose: () => void; onSaved: (next: Student) => void }) {
  const [remark, setRemark] = useState(student.remark ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = () => {
    setSaving(true); setError('');
    fetch(`${base}/${encodeURIComponent(student.id)}/remark`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remark }) })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error('save failed'); onSaved(data as Student); onClose(); })
      .catch(() => setError('We could not save that remark. Try again.'))
      .finally(() => setSaving(false));
  };
  return <PanelShell title={student.fullName} subtitle={`${student.id} · remark`} onClose={onClose} testId="panel-remark">
    <label className="grid gap-1.5 text-sm font-medium">Remark
      <Textarea rows={5} placeholder="Type anything you want kept against this student" value={remark} onChange={(e) => setRemark(e.target.value)} data-testid="input-remark" />
    </label>
    <p className="mt-2 text-xs text-muted-foreground">Only the admin and module owners can see this. Clear the box to remove it.</p>
    {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-remark">Cancel</Button>
      <Button type="button" onClick={save} disabled={saving} data-testid="button-save-remark">{saving ? 'Saving…' : 'Save remark'}</Button>
    </div>
  </PanelShell>;
}

// Delete and remark work the same on both portals, so the buttons live in one place.
function RecordActions({ student, base, onRemark, onDeleted }: { student: Student; base: string; onRemark: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const remove = () => {
    if (!window.confirm(`Delete ${student.fullName}'s record ${student.id}? Their attendance and marks will be removed too.`)) return;
    setDeleting(true);
    fetch(`${base}/${encodeURIComponent(student.id)}`, { method: 'DELETE' })
      .then((res) => { if (!res.ok) throw new Error('delete failed'); onDeleted(); })
      .catch(() => window.alert('We could not delete that record. Try again.'))
      .finally(() => setDeleting(false));
  };
  return <>
    <button type="button" onClick={(e) => { e.stopPropagation(); onRemark(); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${student.remark ? 'bg-accent/25 text-primary hover:bg-accent/40' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`} title={student.remark ?? 'Add a remark'} data-testid={`button-remark-${student.id}`}>{student.remark ? 'Remark ✓' : 'Remark'}</button>
    <button type="button" onClick={(e) => { e.stopPropagation(); remove(); }} disabled={deleting} className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-destructive" data-testid={`button-delete-${student.id}`} aria-label={`Delete ${student.fullName}`}><Trash2 size={15} /></button>
  </>;
}

type StatusPayload = { attendance: string[]; assessment: string[]; pendingAttendance: Record<string, number>; pendingMarks: Record<string, number> };

// Both are measured against the current date. Attendance is green once today has been
// marked and goes red again tomorrow; marks are green while every project due by today
// has been uploaded. The module desk asks about its own module, the admin about all three.
function useStudentStatus(url: string, refreshToken: number) {
  const [state, setState] = useState<StatusPayload>({ attendance: [], assessment: [], pendingAttendance: {}, pendingMarks: {} });
  useEffect(() => {
    let alive = true;
    fetch(url).then((res) => res.json().then((data) => ({ ok: res.ok, data }))).then(({ ok, data }) => {
      if (alive && ok) setState(data as StatusPayload);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [url, refreshToken]);
  return (student: Student): RowStatus => ({
    attendance: state.attendance.includes(student.id),
    marks: state.assessment.includes(student.id),
    attendancePending: state.pendingAttendance[student.id] ?? 0,
    marksPending: state.pendingMarks[student.id] ?? 0,
  });
}

function TeacherStudentListPage({ user }: { user: CurrentUser }) {
  const students = useListTeacherStudents();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [remarkFor, setRemarkFor] = useState<Student | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const statusFor = useStudentStatus('/api/teacher/overview/students', refreshToken);

  const refresh = () => {
    setRefreshToken((v) => v + 1);
    // Keeps the module desk and the admin module report honest on their next read.
    queryClient.invalidateQueries({ queryKey: getListTeacherStudentsQueryKey() });
    void students.refetch();
  };

  const query = search.trim().toLowerCase();
  const rows = (students.data ?? []).filter((student) => studentMatches(student, query));

  return <>
    <PageHeader kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`} title="Student list" detail="Open a student to see their full record and upload project marks. Attendance is marked from the module desk." />
    <StudentSearchBar value={search} onChange={setSearch} count={rows.length} testId="input-search-teacher-students" />
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-5 font-display text-2xl font-bold">All students</h2>
      {students.isError ? <ErrorState retry={() => students.refetch()} />
        : students.isLoading ? <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
        : rows.length === 0 ? <EmptyState title="No matching students" detail="Try a name, student ID, contact number or email." icon={UserRound} />
        : <StudentTable students={rows} testIdPrefix="row-teacher-student" statusFor={statusFor} onRowClick={(student) => setLocation(`/teacher/students/${student.id}`)} action={(student) => (
            <RecordActions student={student} base="/api/teacher/students" onRemark={() => setRemarkFor(student)} onDeleted={refresh} />
          )} />}
    </section>
    {remarkFor && <RemarkPanel student={remarkFor} base="/api/teacher/students" onClose={() => setRemarkFor(null)} onSaved={refresh} />}
  </>;
}

type ProjectMark = { project: number; cycle: number; marks: number | null; feedback: string | null; projectName: string | null };
type ReportModule = { module: Module; present: number; absent: number; total: number; percentage: number; recorded: boolean; projects: ProjectMark[] };
type ReportMonth = { month: number; start: string | null; end: string | null; present: number; absent: number; total: number; percentage: number; recorded: boolean; modules: ReportModule[] };
type StudentReport = {
  joinedOn: string | null;
  courseStart: string | null;
  courseEnd: string | null;
  overall: { present: number; absent: number; total: number; percentage: number };
  months: ReportMonth[];
};

function percentTone(value: number): string {
  if (value >= 75) return 'text-primary';
  if (value >= 50) return 'text-foreground';
  return 'text-destructive';
}

// The API sends each month's real first and last day; month 1 starts on the
// admission date rather than the 1st.
function monthRange(entry: ReportMonth): string {
  if (!entry.start || !entry.end) return '';
  const label = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]?.slice(0, 3)}`;
  };
  return `${label(entry.start)} – ${label(entry.end)}`;
}

// moduleFilter narrows the whole report to one module, so a module owner sees their
// own attendance and their own project marks instead of all three modules at once.
function MonthlyProgress({ report, compact = false, moduleFilter }: { report: StudentReport; compact?: boolean; moduleFilter?: Module | null }) {
  const firstRecorded = report.months.find((m) => m.recorded)?.month ?? 1;
  const [month, setMonth] = useState(firstRecorded);
  const selected = report.months.find((m) => m.month === month) ?? report.months[0];
  if (!selected) return null;
  const range = monthRange(selected);
  const shownModules = moduleFilter ? selected.modules.filter((item) => item.module === moduleFilter) : selected.modules;
  // With a filter on, the headline tiles count that module's days rather than the
  // "present for anything that day" total.
  const scoped = moduleFilter ? shownModules[0] : null;
  const present = scoped ? scoped.present : selected.present;
  const absent = scoped ? scoped.absent : selected.absent;
  const percentage = scoped ? scoped.percentage : selected.percentage;
  const scopeLabel = moduleFilter ? moduleNames[moduleFilter] : null;

  return <>
    <section className={`rounded-xl border border-border bg-card ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-primary">Attendance{scopeLabel ? ` · ${scopeLabel}` : ''}</p>
          <h2 className={`mt-1 font-display font-bold ${compact ? 'text-xl' : 'text-2xl'}`}>Monthly report</h2>
          {range && <p className="mt-1 text-xs text-muted-foreground">Month {selected.month} · {range}{report.joinedOn ? ` · admitted ${report.joinedOn}` : ''}</p>}
        </div>
        <label className="grid gap-1.5 text-sm font-medium">Month
          <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-report-month">
            {report.months.map((m) => <option key={m.month} value={m.month}>Month {m.month}{m.recorded ? '' : ' — no records'}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-accent/40 bg-accent/15 p-4" data-testid="tile-month-percentage">
          <p className="text-xs font-medium text-muted-foreground">This month</p>
          <p className={`mt-1 font-display text-3xl font-bold ${percentTone(percentage)}`}>{percentage}%</p>
        </div>
        <div className="rounded-lg border border-border p-4" data-testid="tile-month-present">
          <p className="text-xs font-medium text-muted-foreground">Present</p>
          <p className="mt-1 font-display text-3xl font-bold text-primary">{present}</p>
          <p className="text-xs text-muted-foreground">of {selected.total} days</p>
        </div>
        <div className="rounded-lg border border-border p-4" data-testid="tile-month-absent">
          <p className="text-xs font-medium text-muted-foreground">Absent</p>
          <p className="mt-1 font-display text-3xl font-bold text-destructive">{absent}</p>
          <p className="text-xs text-muted-foreground">of {selected.total} days</p>
        </div>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, percentage)}%` }} /></div>

      <div className="mt-4 grid gap-2">
        {shownModules.map((item) => <div key={item.module} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm" data-testid={`row-month-module-${item.module}`}>
          <span className="font-semibold">{moduleNames[item.module]}</span>
          <span className="text-xs text-muted-foreground">{item.present} present · {item.absent} absent · <span className={`font-semibold ${percentTone(item.percentage)}`}>{item.percentage}%</span></span>
        </div>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Month {selected.month} has <strong className="text-foreground">{selected.total}</strong> teaching days{range ? ` (${range})` : ''}. Sundays are off. The course runs six months from the admission date, and each month runs from that date to the day before the next one.</p>
    </section>

    <section className={`mt-6 rounded-xl border border-border bg-card ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-primary">Assessments{scopeLabel ? ` · ${scopeLabel}` : ''}</p>
          <h2 className={`mt-1 font-display font-bold ${compact ? 'text-xl' : 'text-2xl'}`}>Project marks — month {selected.month}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{scopeLabel ? `${scopeLabel} runs two projects a month.` : 'Each module runs two projects a month.'}{range ? ` Month ${selected.month} is ${range}.` : ''}</p>
        </div>
        <label className="grid gap-1.5 text-sm font-medium">Month
          <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-marks-month">
            {report.months.map((m) => <option key={m.month} value={m.month}>Month {m.month}</option>)}
          </select>
        </label>
      </div>
      <div className={`mt-5 grid gap-3 ${compact || scoped ? '' : 'lg:grid-cols-3'}`}>
        {shownModules.map((item) => <div key={item.module} className="rounded-lg border border-border p-4" data-testid={`card-marks-${item.module}`}>
          <p className="font-semibold">{moduleNames[item.module]}</p>
          <div className="mt-3 grid gap-2">
            {item.projects.map((project) => <div key={project.project} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 text-muted-foreground">Project {project.project}{project.projectName ? <span className="block truncate text-xs font-medium text-foreground">{project.projectName}</span> : null}</span>
              {project.marks == null
                ? <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Not marked</span>
                : <span className={`rounded-md px-2 py-1 font-mono-ui text-xs font-medium ${project.marks >= 70 ? 'bg-accent/25 text-primary' : 'bg-destructive/10 text-destructive'}`} data-testid={`marks-${item.module}-${project.project}`}>{project.marks}/100</span>}
            </div>)}
            {item.projects.some((project) => project.feedback) && <p className="mt-1 text-xs text-muted-foreground">{item.projects.filter((project) => project.feedback).map((project) => `P${project.project}: ${project.feedback}`).join(' · ')}</p>}
          </div>
        </div>)}
      </div>
    </section>
  </>;
}

function useStudentReport(url: string) {
  const [report, setReport] = useState<StudentReport | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (!alive) return; if (ok) setReport(data as StudentReport); else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);
  return { report, failed };
}

function StudentProgressSection({ base, moduleFilter }: { base: string; moduleFilter?: Module | null }) {
  const { report, failed } = useStudentReport(`${base}/report`);
  if (failed) return null;
  if (!report) return <div className="mt-6 h-40 animate-pulse rounded-xl bg-muted" />;
  return <div className="mt-6"><MonthlyProgress report={report} compact moduleFilter={moduleFilter} /></div>;
}

// ------------------------------------------------------------------ announcements
type Announcement = {
  id: number;
  module: Module;
  title: string;
  body: string;
  authorName: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function noticeDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
}

// A notice is a title until you ask for it. With three modules posting into the same
// portal, an expanded list buried each notice in the last one's body, so the row shows
// the headline and opens on click.
function NoticeRow({ notice, children, editing, busy, onSave, onCancel }: {
  notice: Announcement;
  children?: ReactNode;
  editing?: boolean;
  busy?: boolean;
  onSave?: (next: { title: string; body: string }) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(notice.title);
  const [body, setBody] = useState(notice.body);

  // Reopening the editor must start from what is stored, not from a half-typed
  // draft the staff member abandoned last time.
  useEffect(() => {
    if (editing) { setTitle(notice.title); setBody(notice.body); }
  }, [editing, notice.title, notice.body]);

  const expanded = open || !!editing;

  return <article className="rounded-xl border border-border bg-card" data-testid={`notice-${notice.id}`}>
    <div className="flex items-start gap-2 p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded} disabled={editing} className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default" data-testid={`button-toggle-notice-${notice.id}`}>
        <ChevronDown size={18} className={`mt-0.5 shrink-0 text-primary transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <span className="min-w-0">
          <span className="block font-display text-lg font-bold leading-snug">{notice.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {notice.published ? `Published ${noticeDate(notice.publishedAt)}` : `Draft · written ${noticeDate(notice.createdAt)}`}
            {notice.authorName ? ` · ${notice.authorName}` : ''}
          </span>
        </span>
      </button>
      {children}
    </div>

    {editing
      ? <div className="border-t border-border p-4" data-testid={`notice-edit-${notice.id}`}>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid={`input-edit-title-${notice.id}`} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Message<Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} data-testid={`input-edit-body-${notice.id}`} /></label>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy} data-testid={`button-cancel-edit-${notice.id}`}>Cancel</Button>
            <Button type="button" size="sm" onClick={() => onSave?.({ title, body })} disabled={busy} data-testid={`button-save-edit-${notice.id}`}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      : expanded && <p className="whitespace-pre-wrap border-t border-border px-4 py-4 pl-11 text-sm text-muted-foreground" data-testid={`notice-body-${notice.id}`}>{notice.body}</p>}
  </article>;
}

// One section per module. The student portal and the admin desk pass all three; a
// module desk passes only its own, so an AI teacher never sees an empty "Social
// Media" heading for notices that are not theirs to write.
function NoticesByModule({ notices, emptyDetail, modules: visible = adminModules, actions, renderRow }: {
  notices: Announcement[];
  emptyDetail: string;
  modules?: typeof adminModules;
  actions?: (notice: Announcement) => ReactNode;
  renderRow?: (notice: Announcement) => ReactNode;
}) {
  return <div className="grid gap-6">{visible.map((meta) => {
    const items = notices.filter((n) => n.module === meta.key);
    return <section key={meta.key} data-testid={`notice-group-${meta.key}`}>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-xl font-bold">{meta.name}</h2>
        <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{items.length} {items.length === 1 ? 'notice' : 'notices'}</span>
      </div>
      {items.length === 0
        ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground" data-testid={`notice-group-empty-${meta.key}`}>{emptyDetail}</p>
        : <div className="grid gap-3">{items.map((item) => renderRow
            ? <Fragment key={item.id}>{renderRow(item)}</Fragment>
            : <NoticeRow key={item.id} notice={item}>{actions?.(item)}</NoticeRow>)}</div>}
    </section>;
  })}</div>;
}

// One screen, two desks. A module owner writes for their own module; the admin sits
// above all three, picks the module on the way in, and can moderate anything a
// teacher wrote. `scope` swaps the API prefix and turns the module picker on.
function AnnouncementsPage({ user, scope }: { user: CurrentUser; scope: 'admin' | 'teacher' }) {
  const isAdmin = scope === 'admin';
  const base = `/api/${scope}/announcements`;
  const [notices, setNotices] = useState<Announcement[] | null>(null);
  const [module, setModule] = useState<Module>(user.module ?? 'ai');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(base)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (alive) setNotices(ok ? (data as Announcement[]) : []); })
      .catch(() => { if (alive) setNotices([]); });
    return () => { alive = false; };
  }, [base, reloadToken]);

  const refresh = () => setReloadToken((v) => v + 1);

  const create = (publish: boolean) => {
    if (!title.trim() || !body.trim()) { setError('Enter a title and a message.'); return; }
    setBusy(true); setError(''); setNotice('');
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isAdmin ? { title, body, publish, module } : { title, body, publish }),
    })
      .then((res) => { if (!res.ok) throw new Error('save failed'); })
      .then(() => {
        setNotice(publish ? 'Published — students can read it now.' : 'Saved as a draft. Students cannot see it yet.');
        setTitle(''); setBody(''); refresh();
      })
      .catch(() => setError('We could not save that notice. Try again.'))
      .finally(() => setBusy(false));
  };

  const setPublished = (id: number, publish: boolean) => {
    setError(''); setNotice('');
    fetch(`${base}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish }),
    })
      .then((res) => { if (!res.ok) throw new Error('update failed'); setNotice(publish ? 'Published.' : 'Taken down — students can no longer see it.'); refresh(); })
      .catch(() => setError('We could not update that notice. Try again.'));
  };

  const remove = (id: number, noticeTitle: string) => {
    if (!window.confirm(`Delete the notice "${noticeTitle}"? This cannot be undone.`)) return;
    setError(''); setNotice('');
    fetch(`${base}/${id}`, { method: 'DELETE' })
      .then((res) => { if (!res.ok) throw new Error('delete failed'); setNotice('Notice deleted.'); refresh(); })
      .catch(() => setError('We could not delete that notice. Try again.'));
  };

  const saveEdit = (id: number, next: { title: string; body: string }) => {
    if (!next.title.trim() || !next.body.trim()) { setError('Enter a title and a message.'); return; }
    setBusy(true); setError(''); setNotice('');
    fetch(`${base}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next.title, body: next.body }),
    })
      .then((res) => { if (!res.ok) throw new Error('update failed'); setNotice('Notice updated.'); setEditingId(null); refresh(); })
      .catch(() => setError('We could not save that change. Try again.'))
      .finally(() => setBusy(false));
  };

  const published = (notices ?? []).filter((n) => n.published);
  const drafts = (notices ?? []).filter((n) => !n.published);
  // The teacher API already scopes to their module; this stops the UI drawing empty
  // headings for the two modules they can neither read nor write.
  const visibleModules = isAdmin ? adminModules : adminModules.filter((m) => m.key === (user.module ?? 'ai'));

  return <>
    <PageHeader
      kicker={isAdmin ? 'Admin / announcements' : `Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`}
      title="Announcements"
      detail={isAdmin
        ? 'Every notice across all three modules. Write one for any module, or take down something a module owner posted.'
        : `Notices for ${user.module ? moduleNames[user.module] : 'your module'} only. Publish one and it appears on your students' portal straight away.`} />

    <section className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-semibold text-primary">New notice</p>
      <h2 className="mt-1 font-display text-2xl font-bold">Write an announcement</h2>
      <div className="mt-5 grid gap-3">
        {isAdmin && <label className="grid gap-1.5 text-sm font-medium">Module<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={module} onChange={(e) => setModule(e.target.value as Module)} data-testid="select-notice-module">{(Object.keys(moduleNames) as Module[]).map((key) => <option key={key} value={key}>{moduleNames[key]}</option>)}</select></label>}
        <label className="grid gap-1.5 text-sm font-medium">Title<Input placeholder="e.g. Class timings changed for next week" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="input-notice-title" /></label>
        <label className="grid gap-1.5 text-sm font-medium">Message<Textarea rows={5} placeholder={isAdmin ? 'Write what the students need to know' : 'Write what your students need to know'} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} data-testid="input-notice-body" /></label>
      </div>
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-notice-error">{error}</p>}
      {notice && <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-notice-success">{notice}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => create(false)} disabled={busy} data-testid="button-save-draft">Save as draft</Button>
        <Button type="button" size="sm" onClick={() => create(true)} disabled={busy} data-testid="button-publish-notice">{busy ? 'Saving…' : <><Megaphone size={15} /> Publish</>}</Button>
      </div>
    </section>

    <section className="mt-8">
      <div className="mb-5">
        <h2 className="font-display text-2xl font-bold">All notices</h2>
        <p className="mt-1 text-sm text-muted-foreground">{published.length} published · {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}. Click a title to read it; drafts stay off the student portal until you publish them.</p>
      </div>
      {notices == null ? <div className="grid gap-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        : <NoticesByModule
            notices={notices}
            modules={visibleModules}
            emptyDetail="Nothing written for this module yet."
            renderRow={(item) => <NoticeRow
              notice={item}
              editing={editingId === item.id}
              busy={busy}
              onCancel={() => { setEditingId(null); setError(''); }}
              onSave={(next) => saveEdit(item.id, next)}>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className={`hidden rounded-full px-2.5 py-1 font-mono-ui text-[10px] uppercase sm:inline ${item.published ? 'bg-accent/20 text-primary' : 'bg-muted text-muted-foreground'}`}>{item.published ? 'Published' : 'Draft'}</span>
                {!item.published && <Button type="button" size="sm" onClick={() => setPublished(item.id, true)} data-testid={`button-publish-${item.id}`}>Publish</Button>}
                <Button type="button" size="sm" variant="outline" onClick={() => { setEditingId(editingId === item.id ? null : item.id); setError(''); setNotice(''); }} data-testid={`button-edit-${item.id}`}><Pencil size={14} /> Edit</Button>
                <button type="button" onClick={() => remove(item.id, item.title)} className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-destructive" aria-label={`Delete ${item.title}`} data-testid={`button-delete-notice-${item.id}`}><Trash2 size={15} /></button>
              </div>
            </NoticeRow>} />}
    </section>
  </>;
}

// What students see: every published notice, newest first.
function StudentAnnouncementsPage() {
  const [notices, setNotices] = useState<Announcement[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    fetch('/api/student/announcements')
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (ok) setNotices(data as Announcement[]); else setFailed(true); })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  return <>
    <PageHeader kicker="Student / announcements" title="Announcements" detail="Notices from your three modules, kept apart. Click a title to read the whole notice." />
    {failed ? <ErrorState retry={load} />
      : notices == null ? <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
      : <NoticesByModule notices={notices} emptyDetail="No announcements from this module yet." />}
  </>;
}

type StudentProfile = { fullName: string; fathersName: string; course: string; address: string | null; contactNumber: string; email: string; photo: string | null };

// Read-only by design. The six fields come straight from the student's record, so
// whatever staff save on the Add student / student record screens shows up here.
function StudentProfilePage({ user }: { user: CurrentUser }) {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    fetch('/api/student/profile')
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (ok) setProfile(data as StudentProfile); else setFailed(true); })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  if (failed) return <><PageHeader kicker="Student / my profile" title="My profile" detail="We could not open your details." /><ErrorState retry={load} /></>;
  if (!profile) return <LoadingScreen label="Opening your profile" />;

  const rows: Array<[string, string]> = [
    ['Name', profile.fullName],
    ["Father's name", profile.fathersName],
    ['Course', profile.course],
    ['Address', profile.address || '—'],
    ['Contact no.', profile.contactNumber],
    ['Email', profile.email],
  ];

  return <>
    <PageHeader kicker="Student / my profile" title="My profile" detail="The details your institute holds for you. To change anything, ask your institute." action={<div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"><Avatar photo={profile.photo} name={profile.fullName} size={32} testId="header-profile-photo" /><span className="text-xs font-semibold">{user.studentId ?? 'Student'}</span></div>} />
    <section className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-semibold text-primary">Your record</p>
      <h2 className="mt-1 font-display text-2xl font-bold">Basic details</h2>
      <div className="mt-5 flex items-center gap-4 border-b border-border/70 pb-5">
        <Avatar photo={profile.photo} name={profile.fullName} size={88} testId="profile-photo" placeholderTestId="profile-photo-placeholder" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold">{profile.fullName}</p>
          <p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{user.studentId ?? 'Student'}</p>
          {!profile.photo && <p className="mt-1 text-xs text-muted-foreground">No photo on your record yet — your institute can add one.</p>}
        </div>
      </div>
      <dl className="mt-2 grid gap-0 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="border-b border-border/70 py-4 pr-4" data-testid={`profile-${label.toLowerCase().replaceAll(' ', '-').replaceAll('.', '')}`}>
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
      </div>)}</dl>
    </section>
  </>;
}

// Placeholder, same as the module information page — the brief, the deliverables and
// the submission rules will be filled in later.
function StudentProjectPage() {
  const { docs, failed } = useCourseDocuments('student');
  const find = (module: Module, kind: DocumentKind) => docs?.find((d) => d.module === module && d.kind === kind);
  return <>
    <PageHeader kicker="Student / project" title="Project" detail="The project plan and the guidelines for each module. Open one to read it in full." />
    {failed ? <ErrorState />
      : docs == null ? <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-muted" />)}</div>
      : <div className="grid gap-4">{adminModules.map((meta) => (
          <section key={meta.key} className="rounded-xl border border-border bg-card p-5" data-testid={`project-docs-${meta.key}`}>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Module {meta.number}</p>
            <h2 className="mt-1 font-display text-2xl font-bold">{meta.name}</h2>
            <div className="mt-4 grid gap-2.5">
              <DocLink scope="student" kind="project_plan" doc={find(meta.key, 'project_plan')} />
              <DocLink scope="student" kind="project_guidelines" doc={find(meta.key, 'project_guidelines')} />
            </div>
          </section>
        ))}</div>}
  </>;
}

function StudentModulesPage() {
  const { docs, failed } = useCourseDocuments('student');
  const find = (module: Module) => docs?.find((d) => d.module === module && d.kind === 'syllabus');
  return <>
    <PageHeader kicker="Student / module information" title="Module information" detail="What each of your three modules covers. Open a syllabus to read it in full." />
    {failed ? <ErrorState />
      : docs == null ? <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>
      : <div className="grid gap-4">{adminModules.map((meta) => (
          <section key={meta.key} className="rounded-xl border border-border bg-card p-5" data-testid={`module-info-${meta.key}`}>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Module {meta.number}</p>
            <h2 className="mt-1 font-display text-2xl font-bold">{meta.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{meta.tagline}</p>
            <div className="mt-4"><DocLink scope="student" kind="syllabus" doc={find(meta.key)} /></div>
          </section>
        ))}</div>}
  </>;
}

// Where staff replace the course PDFs. Upload overwrites whatever that slot held, so
// "delete the old one and put the new one up" is a single action; Remove is there for
// taking a file down without a replacement ready.
function DocumentSlot({ scope, module, kind, doc, onChanged, onError, onNotice }: {
  scope: 'admin' | 'teacher';
  module: Module;
  kind: DocumentKind;
  doc?: CourseDocument;
  onChanged: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const meta = documentLabels[kind];
  const [busy, setBusy] = useState(false);
  const inputId = `upload-${module}-${kind}`;

  const upload = (file: File) => {
    if (!/\.pdf$/i.test(file.name)) { onError('Only PDF files can be uploaded.'); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { onError(`That PDF is ${fileSize(file.size)}. The limit is 8 MB.`); return; }
    setBusy(true); onError(''); onNotice('');
    const reader = new FileReader();
    reader.onerror = () => { setBusy(false); onError('That file could not be read. Try again.'); };
    reader.onload = () => {
      const body = scope === 'admin'
        ? { module, kind, fileName: file.name, content: reader.result }
        : { kind, fileName: file.name, content: reader.result };
      fetch(`/api/${scope}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error((data as { error?: string })?.error || 'upload failed');
          onNotice(doc ? `${meta.label} replaced — students see the new file now.` : `${meta.label} uploaded — students can read it now.`);
          onChanged();
        })
        .catch((err: Error) => onError(err.message === 'upload failed' ? 'We could not upload that file. Try again.' : err.message))
        .finally(() => setBusy(false));
    };
    reader.readAsDataURL(file);
  };

  const remove = () => {
    if (!doc) return;
    if (!window.confirm(`Remove the ${meta.label.toLowerCase()} for ${moduleNames[module]}? Students will stop seeing it straight away.`)) return;
    onError(''); onNotice('');
    const url = scope === 'admin' ? `/api/admin/documents/${module}/${kind}` : `/api/teacher/documents/${kind}`;
    fetch(url, { method: 'DELETE' })
      .then((res) => { if (!res.ok) throw new Error('delete failed'); onNotice(`${meta.label} removed.`); onChanged(); })
      .catch(() => onError('We could not remove that file. Try again.'));
  };

  return <div className="rounded-lg border border-border bg-background p-4" data-testid={`doc-slot-${module}-${kind}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${doc ? 'bg-accent/20 text-primary' : 'bg-muted text-muted-foreground'}`}><FileText size={17} /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{meta.label}</p>
          {doc
            ? <p className="mt-0.5 break-all text-xs text-muted-foreground">{doc.fileName} · {fileSize(doc.sizeBytes)} · updated {noticeDate(doc.updatedAt)}{doc.uploadedByName ? ` by ${doc.uploadedByName}` : ''}</p>
            : <p className="mt-0.5 text-xs text-muted-foreground">Nothing uploaded — students see "not uploaded yet".</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {doc && <a href={documentHref(scope, doc)} target="_blank" rel="noreferrer" className="rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted" data-testid={`button-view-${module}-${kind}`}>View</a>}
        <label htmlFor={inputId} className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${busy ? 'pointer-events-none opacity-60' : ''} bg-primary text-primary-foreground hover:opacity-90`} data-testid={`button-upload-${module}-${kind}`}>
          {busy ? 'Uploading…' : doc ? 'Replace' : 'Upload'}
        </label>
        <input
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) upload(file); }}
          data-testid={`input-upload-${module}-${kind}`} />
        {doc && <button type="button" onClick={remove} className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-destructive" aria-label={`Remove ${meta.label}`} data-testid={`button-remove-${module}-${kind}`}><Trash2 size={15} /></button>}
      </div>
    </div>
  </div>;
}

// Admin manages all three modules; a module desk only ever sees its own.
function CourseDocumentsPage({ user, scope }: { user: CurrentUser; scope: 'admin' | 'teacher' }) {
  const { docs, failed, refresh } = useCourseDocuments(scope);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const visible = scope === 'admin' ? adminModules : adminModules.filter((m) => m.key === (user.module ?? 'ai'));
  const find = (module: Module, kind: DocumentKind) => docs?.find((d) => d.module === module && d.kind === kind);

  return <>
    <PageHeader
      kicker={scope === 'admin' ? 'Admin / course files' : `Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`}
      title="Course files"
      detail={scope === 'admin'
        ? 'The syllabus and project PDFs students read. Uploading a file replaces the one already there, so the old version disappears from the student portal at the same moment.'
        : 'The syllabus and project PDFs your students read. Uploading a file replaces the one already there — the old version comes down straight away.'} />

    {error && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-documents-error">{error}</p>}
    {notice && <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-documents-success">{notice}</p>}

    {failed ? <ErrorState retry={refresh} />
      : docs == null ? <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-60 animate-pulse rounded-xl bg-muted" />)}</div>
      : <div className="grid gap-4">{visible.map((meta) => (
          <section key={meta.key} className="rounded-xl border border-border bg-card p-5" data-testid={`documents-${meta.key}`}>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Module {meta.number}</p>
            <h2 className="mt-1 font-display text-2xl font-bold">{meta.name}</h2>
            <div className="mt-4 grid gap-2.5">{documentKinds.map((kind) => (
              <DocumentSlot key={kind} scope={scope} module={meta.key} kind={kind} doc={find(meta.key, kind)} onChanged={refresh} onError={setError} onNotice={setNotice} />
            ))}</div>
          </section>
        ))}</div>}

    <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><Upload size={14} /> PDF only, up to 8 MB per file.</p>
  </>;
}

function StudentPage({ user }: { user: CurrentUser }) {
  const { report, failed } = useStudentReport('/api/student/monthly');
  return <>
    <PageHeader kicker="Student / personal record" title={`Hello, ${user.displayName.split(' ')[0]}.`} detail="Your attendance month by month, and the marks for both projects in every module." action={<div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent font-bold text-primary">{initials(user.displayName)}</span><span className="text-xs font-semibold">{user.studentId ?? 'Student'}</span></div>} />
    {failed ? <ErrorState />
      : !report ? <div className="grid gap-4"><div className="h-40 animate-pulse rounded-xl bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>
      : <>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <StatCard label="Total teaching days" value={report.overall.total} detail={report.courseStart && report.courseEnd ? `${report.courseStart} to ${report.courseEnd} · Sundays off` : 'across your six months'} icon={BookOpen} />
          <StatCard label="Present / absent" value={`${report.overall.present} / ${report.overall.absent}`} detail={`${report.overall.percentage}% overall, updated as each month is uploaded`} icon={CalendarCheck2} accent />
        </div>
        <MonthlyProgress report={report} />
      </>}
  </>;
}

type NewStudentInput = { fullName: string; fathersName: string; course: string; dateOfJoining: string; contactNumber: string; email: string; password: string; address: string | null; guardianContact: string | null };

function JoiningDateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  return <label className="grid gap-1.5 text-sm font-medium">Joining date
    <input type="date" className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)} data-testid="input-student-doj" aria-label="Joining date" />
  </label>;
}

function StudentEnrolForm({ kicker, total, creating, photoBase, onCreate }: { kicker: string; total: number; creating: boolean; photoBase: string; onCreate: (data: NewStudentInput) => Promise<Student> }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const emptyForm = { fullName: '', fathersName: '', course: 'Digital Marketing with AI', dateOfJoining: '', contactNumber: '', guardianContact: '', address: '', email: '', password: '', confirmPassword: '' };
  const [form, setForm] = useState(emptyForm);
  // The photo is held here and attached straight after the record exists, because the
  // student only gets an id once the create has gone through.
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const updateForm = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((v) => ({ ...v, [key]: event.target.value }));

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    setPhotoError(''); setPhotoBusy(true);
    readSquarePhoto(file)
      .then(setPhoto)
      .catch(() => setPhotoError('We could not read that image. Try a PNG or JPEG.'))
      .finally(() => { setPhotoBusy(false); if (photoRef.current) photoRef.current.value = ''; });
  };

  const clearPhoto = () => { setPhoto(null); setPhotoError(''); if (photoRef.current) photoRef.current.value = ''; };

  const handleEnroll = (event: FormEvent) => {
    event.preventDefault();
    setNotice('');
    setError('');
    if (form.password.trim() !== form.confirmPassword.trim()) { setError('The passwords do not match.'); return; }
    if (!form.dateOfJoining) { setError('Choose the joining date — day, month and year.'); return; }
    const joining = new Date(`${form.dateOfJoining}T00:00:00Z`);
    if (Number.isNaN(joining.getTime()) || joining.toISOString().slice(0, 10) !== form.dateOfJoining) {
      setError('That joining date does not exist. Check the day against the month.');
      return;
    }
    const emailError = validateStudentEmail(form.email);
    if (emailError) { setError(emailError); return; }
    const email = form.email.trim().toLowerCase();
    const password = form.password.trim();
    if (!password) { setError('Enter a password for this student.'); return; }
    onCreate({ fullName: form.fullName.trim(), fathersName: form.fathersName.trim(), course: form.course, dateOfJoining: form.dateOfJoining, contactNumber: form.contactNumber.trim(), email, password, address: form.address.trim() || null, guardianContact: form.guardianContact.trim() || null })
      .then((student) => {
        if (!photo) return student;
        // A failed photo must not read as a failed enrolment — the record is already saved.
        return fetch(`${photoBase}/${encodeURIComponent(student.id)}/photo`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo }) })
          .then((res) => { if (!res.ok) setPhotoError('The student was enrolled, but the photo did not upload. Add it from their record.'); return student; })
          .catch(() => { setPhotoError('The student was enrolled, but the photo did not upload. Add it from their record.'); return student; });
      })
      .then((student) => { setNotice(`${student.fullName} has been enrolled as ${student.id}. They sign in with ${email} and the password ${password}`); setForm(emptyForm); setPhoto(null); })
      .catch(() => setError('We could not create that student record. Check the form and try again.'));
  };

  return <><PageHeader kicker={kicker} title="Students" detail="Enroll new learners and open any record to manage their access." action={<div className="flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/15 px-3 py-2 text-xs font-semibold text-primary"><Users size={15} /> {total} enrolled</div>} />
    <section className="rounded-xl border border-border bg-card p-5"><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">New enrolment</p><h2 className="mt-1 font-display text-2xl font-bold">Add a student</h2><p className="mt-2 text-sm text-muted-foreground">The student signs in with the email and password you set here.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/30 p-4">
        {photo
          ? <img src={photo} alt="Selected student" className="h-[72px] w-[72px] shrink-0 rounded-full object-cover" data-testid="preview-new-student-photo" />
          : <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><UserRound size={28} /></span>}
        <div>
          <p className="text-sm font-semibold">Student photo <span className="font-normal text-muted-foreground">(optional)</span></p>
          <p className="mt-1 text-xs text-muted-foreground">Cropped to a square and shrunk before upload, so any phone photo is fine.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} data-testid="input-new-student-photo" />
            <Button type="button" size="sm" variant="outline" onClick={() => photoRef.current?.click()} disabled={photoBusy} data-testid="button-choose-new-student-photo">{photoBusy ? 'Reading…' : <><Plus size={14} /> {photo ? 'Replace photo' : 'Add photo'}</>}</Button>
            {photo && <Button type="button" size="sm" variant="outline" onClick={clearPhoto} data-testid="button-clear-new-student-photo">Remove</Button>}
          </div>
        </div>
      </div>
      {photoError && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-new-student-photo-error">{photoError}</p>}
      <form onSubmit={handleEnroll} className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><div className="xl:col-span-1"><Field label="Full name" value={form.fullName} onChange={updateForm('fullName')} minLength={2} required data-testid="input-student-full-name" /></div><div className="xl:col-span-1"><Field label="Father&apos;s name" value={form.fathersName} onChange={updateForm('fathersName')} minLength={2} required data-testid="input-student-fathers-name" /></div><label className="grid gap-1.5 text-sm font-medium">Course<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={form.course} onChange={updateForm('course')} data-testid="select-student-course"><option>Digital Marketing with AI</option></select></label><JoiningDateField value={form.dateOfJoining} onChange={(iso) => setForm((v) => ({ ...v, dateOfJoining: iso }))} /><Field label="Contact number" value={form.contactNumber} onChange={updateForm('contactNumber')} minLength={6} maxLength={12} required data-testid="input-student-contact" /><Field label="Parent / guardian contact" value={form.guardianContact} onChange={updateForm('guardianContact')} maxLength={12} placeholder="Optional" data-testid="input-student-guardian-contact" /><Field label="Email address" type="email" value={form.email} onChange={updateForm('email')} required data-testid="input-student-email" /><div className="sm:col-span-2 xl:col-span-3"><label className="grid gap-1.5 text-sm font-medium">Address<Textarea rows={2} placeholder="Optional — house, street, city, pin code" value={form.address} onChange={(ev) => setForm((v) => ({ ...v, address: ev.target.value }))} data-testid="input-student-address" /></label></div><PasswordField label="Password" value={form.password} onChange={updateForm('password')} minLength={6} required data-testid="input-student-password" toggleTestId="button-toggle-enrol-pwd" /><PasswordField label="Confirm password" value={form.confirmPassword} onChange={updateForm('confirmPassword')} minLength={6} required data-testid="input-student-confirm-password" toggleTestId="button-toggle-enrol-confirm-pwd" /><div className="flex items-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { const next = randomPassword(); setForm((v) => ({ ...v, password: next, confirmPassword: next })); }} className="h-9" data-testid="button-generate-password"><KeyRound size={14} /> Generate</Button></div><div className="flex items-end sm:col-span-2 xl:col-span-3"><Button type="submit" disabled={creating} data-testid="button-save-student">{creating ? 'Enrolling…' : <><Plus size={15} /> Enroll student</>}</Button></div></form>{error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-enroll-error">{error}</p>}{notice && <p className="mt-3 rounded-md bg-accent/15 px-3 py-2 text-sm font-medium text-primary" data-testid="status-enroll-success">{notice}</p>}</section></>;
}

function AdminStudentsPage() {
  const students = useListStudents(undefined, { query: { queryKey: getListStudentsQueryKey(undefined) } });
  const create = useCreateStudent();
  return <StudentEnrolForm kicker="Admin / student room" total={students.data?.length ?? 0} creating={create.isPending} photoBase="/api/admin/students"
    onCreate={(data) => new Promise<Student>((resolve, reject) => create.mutate({ data }, {
      onSuccess: (student) => { queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() }); resolve(student); },
      onError: () => reject(new Error('create failed')),
    }))} />;
}

function TeacherAddStudentPage({ user }: { user: CurrentUser }) {
  const students = useListTeacherStudents();
  const [creating, setCreating] = useState(false);
  // Module owners post to /teacher/students; the payload mirrors the admin route exactly.
  const onCreate = (data: NewStudentInput) => {
    setCreating(true);
    return fetch('/api/teacher/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error('create failed');
        queryClient.invalidateQueries({ queryKey: getListTeacherStudentsQueryKey() });
        return body as Student;
      })
      .finally(() => setCreating(false));
  };
  return <StudentEnrolForm kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`} total={students.data?.length ?? 0} creating={creating} photoBase="/api/teacher/students" onCreate={onCreate} />;
}

function AdminEnrolledPage() {
  const [search, setSearch] = useState('');
  const [, setLocation] = useLocation();
  const students = useListStudents(undefined, { query: { queryKey: getListStudentsQueryKey(undefined) } });
  const [remarkFor, setRemarkFor] = useState<Student | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const statusFor = useStudentStatus('/api/admin/students/status', refreshToken);
  const refresh = () => { setRefreshToken((v) => v + 1); queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() }); void students.refetch(); };
  // Same table as the module desk, so the two portals read identically.
  const query = search.trim().toLowerCase();
  const rows = (students.data ?? []).filter((student) => studentMatches(student, query));
  return <>
    <PageHeader kicker="Admin / student room" title="Student list" detail="Open a student to see their full record, photo and sign-in details." />
    <StudentSearchBar value={search} onChange={setSearch} count={rows.length} testId="input-search-students" />
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-5 font-display text-2xl font-bold">All students</h2>
      {students.isError ? <ErrorState retry={() => students.refetch()} />
        : students.isLoading ? <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
        : rows.length === 0 ? <EmptyState title="No matching students" detail="Try a name, student ID, contact number or email." icon={UserRound} />
        : <StudentTable students={rows} testIdPrefix="row-student" statusFor={statusFor} onRowClick={(student) => setLocation(`/admin/students/${student.id}`)} action={(student) => (
            <RecordActions student={student} base="/api/admin/students" onRemark={() => setRemarkFor(student)} onDeleted={refresh} />
          )} />}
    </section>
    {remarkFor && <RemarkPanel student={remarkFor} base="/api/admin/students" onClose={() => setRemarkFor(null)} onSaved={refresh} />}
  </>;
}

// Resize in the browser so a phone photo lands as a small square instead of 4 MB.
function readSquarePhoto(file: File, size = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('decode failed'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('no canvas')); return; }
        const edge = Math.min(image.width, image.height);
        context.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function StudentDetailPage({ scope }: { scope: 'admin' | 'teacher' }) {
  const params = useParams<{ id: string }>();
  const base = `/api/${scope}/students/${encodeURIComponent(params.id)}`;
  const [student, setStudent] = useState<Student | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [password, setPassword] = useState<string | null | undefined>(undefined);
  const [showPassword, setShowPassword] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [passwordForm, setPasswordForm] = useState({ password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [remark, setRemark] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [remarkNotice, setRemarkNotice] = useState('');
  const [remarkError, setRemarkError] = useState('');
  const [reportToken, setReportToken] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: viewer } = useCurrentUser();
  // A module owner sees their own module's attendance and marks; the admin sees all three.
  const moduleFilter = scope === 'teacher' ? (viewer?.module ?? null) : null;

  const load = () => {
    fetch(`${base}/detail`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (ok) { const next = data as Student; setStudent(next); setRemark(next.remark ?? ''); } else setLoadError(true); })
      .catch(() => setLoadError(true));
  };
  useEffect(load, [base]);

  const saveRemark = () => {
    setRemarkSaving(true); setRemarkError(''); setRemarkNotice('');
    fetch(`${base}/remark`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remark }) })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error('save failed'); setStudent(data as Student); setRemarkNotice('Remark saved.'); })
      .catch(() => setRemarkError('We could not save that remark. Try again.'))
      .finally(() => setRemarkSaving(false));
  };

  const revealPassword = () => {
    if (password !== undefined) { setShowPassword((v) => !v); return; }
    fetch(`${base}/credential`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (ok) { setPassword((data as { password: string | null }).password); setShowPassword(true); } })
      .catch(() => undefined);
  };

  const uploadPhoto = (file: File | undefined) => {
    if (!file) return;
    setPhotoError(''); setPhotoBusy(true);
    readSquarePhoto(file)
      .then((photo) => fetch(`${base}/photo`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo }) }))
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error('upload failed'); setStudent(data as Student); })
      .catch(() => setPhotoError('We could not upload that image. Try a PNG or JPEG.'))
      .finally(() => { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ''; });
  };

  const removePhoto = () => {
    setPhotoError(''); setPhotoBusy(true);
    fetch(`${base}/photo`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo: null }) })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error('remove failed'); setStudent(data as Student); })
      .catch(() => setPhotoError('We could not remove that photo. Try again.'))
      .finally(() => setPhotoBusy(false));
  };

  const handlePassword = (event: FormEvent) => {
    event.preventDefault();
    setNotice(''); setError('');
    if (passwordForm.password !== passwordForm.confirmPassword) { setError('The passwords do not match.'); return; }
    setSaving(true);
    fetch(`${base}/password`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: passwordForm.password }) })
      .then((res) => { if (!res.ok) throw new Error('save failed'); setNotice('Password updated.'); setPasswordForm({ password: '', confirmPassword: '' }); setPassword(passwordForm.password); })
      .catch(() => setError('We could not update that password. Try again.'))
      .finally(() => setSaving(false));
  };

  const backHref = scope === 'admin' ? '/admin/students/enrolled' : '/teacher/students';
  if (loadError) return <><PageHeader kicker={`${scope === 'admin' ? 'Admin' : 'Teacher'} / student record`} title="Student record" detail="We could not open this record." /><ErrorState retry={load} /></>;
  if (!student) return <LoadingScreen label="Opening student record" />;

  const rows: Array<[string, string]> = [
    ['Student ID', student.id],
    ['Full name', student.fullName],
    ["Father's name", student.fathersName],
    ['Course', student.course],
    ['Joining date', joinedOn(student.dateOfJoining)],
    ['Contact number', student.contactNumber],
    ['Parent / guardian contact', student.guardianContact || '—'],
    ['Email', student.email],
    ['Address', student.address || '—'],
    ['Registered on', joinedOn(student.registrationDate)],
  ];

  return <>
    <Link href={backHref} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-students"><ChevronLeft size={16} /> Back to student list</Link>
    <PageHeader kicker={`${scope === 'admin' ? 'Admin' : 'Teacher'} / student record`} title={student.fullName} detail="The full record, the photo, and the sign-in details for this learner." action={<StudentAvatar student={student} size={48} />} />
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <section className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold text-primary">Student record</p>
        <h2 className="mt-1 font-display text-2xl font-bold">Complete information</h2>
        <dl className="mt-6 grid gap-0 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="border-b border-border/70 py-4 pr-4" data-testid={`detail-${label.toLowerCase().replaceAll(' ', '-')}`}>
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
        </div>)}</dl>
        <StudentProgressSection key={reportToken} base={base} moduleFilter={moduleFilter} />
        {scope === 'teacher' && <MarksUpload student={student} module={viewer?.module} onSaved={() => setReportToken((v) => v + 1)} />}
      </section>

      <div className="grid gap-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold text-primary">Account</p>
          <h2 className="mt-1 font-display text-2xl font-bold">Photo &amp; password</h2>
          <div className="mt-5 flex items-center gap-4">
            <StudentAvatar student={student} size={72} />
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} data-testid="input-student-photo" />
              <Button type="button" size="sm" onClick={() => fileRef.current?.click()} disabled={photoBusy} data-testid="button-upload-photo">{photoBusy ? 'Uploading…' : <><Plus size={14} /> {student.photo ? 'Replace photo' : 'Upload photo'}</>}</Button>
              {student.photo && <Button type="button" size="sm" variant="outline" onClick={removePhoto} disabled={photoBusy} data-testid="button-remove-photo">Remove</Button>}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Cropped to a square and shrunk before upload, so any phone photo is fine.</p>
          {photoError && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-photo-error">{photoError}</p>}

          <div className="mt-6 border-t border-border pt-5">
          <p className="text-xs font-semibold text-primary">Sign-in details</p>
          <h3 className="mt-1 font-display text-xl font-bold">Password</h3>
          <p className="mt-2 text-sm text-muted-foreground">The password this student signs in with.</p>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono-ui text-sm" data-testid="text-student-password">
              {password === undefined ? '••••••••' : password === null ? <span className="text-muted-foreground">Not stored — set a new one below</span> : showPassword ? password : '••••••••'}
            </span>
            <button type="button" onClick={revealPassword} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-reveal-student-password">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <form onSubmit={handlePassword} className="mt-5 grid gap-3">
            <PasswordField label="New password" value={passwordForm.password} onChange={(e) => setPasswordForm((v) => ({ ...v, password: e.target.value }))} minLength={6} required data-testid="input-new-student-password" toggleTestId="button-toggle-new-student-pwd" />
            <PasswordField label="Confirm new password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((v) => ({ ...v, confirmPassword: e.target.value }))} minLength={6} required data-testid="input-confirm-new-student-password" toggleTestId="button-toggle-confirm-student-pwd" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" type="button" onClick={() => { const next = randomPassword(); setPasswordForm({ password: next, confirmPassword: next }); }} data-testid="button-generate-password"><KeyRound size={14} /> Generate</Button>
              <Button type="submit" size="sm" className="ml-auto" disabled={saving} data-testid="button-update-student-password">{saving ? 'Updating…' : 'Update password'}</Button>
            </div>
          </form>
          {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-password-error">{error}</p>}
          {notice && <p className="mt-3 rounded-md bg-accent/15 px-3 py-2 text-sm font-medium text-primary" data-testid="status-password-success">{notice}</p>}
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="text-xs font-semibold text-primary">Notes</p>
            <h3 className="mt-1 font-display text-xl font-bold">Remark</h3>
            <p className="mt-2 text-sm text-muted-foreground">Only the admin and module owners can see this. Clear the box to remove it.</p>
            <Textarea className="mt-4" rows={4} placeholder="Type anything you want kept against this student" value={remark} onChange={(ev) => setRemark(ev.target.value)} data-testid="input-remark" />
            <div className="mt-3 flex justify-end">
              <Button type="button" size="sm" onClick={saveRemark} disabled={remarkSaving} data-testid="button-save-remark">{remarkSaving ? 'Saving…' : 'Save remark'}</Button>
            </div>
            {remarkError && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-remark-error">{remarkError}</p>}
            {remarkNotice && <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-remark-success">{remarkNotice}</p>}
          </div>
        </section>
      </div>
    </div>
  </>;
}

function PanelShell({ title, subtitle, onClose, testId, children }: { title: string; subtitle: string; onClose: () => void; testId: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-primary/40 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" data-testid={testId}>
    <button type="button" className="fixed inset-0 -z-10 cursor-default" onClick={onClose} aria-label="Close panel" tabIndex={-1} />
    <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-bold leading-tight">{title}</h2>
          <p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{subtitle}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close" data-testid="button-close-panel"><X size={18} /></button>
      </div>
      {children}
    </div>
  </div>;
}

function AdminSettingsPage() {
  const admin = useAdminSession();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  // The admin's real credential lives in Supabase (the `admins` row is only a mapping
  // target), so a reset has to go through Supabase — and be re-verified there first.
  const handlePassword = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(''); setError('');
    if (!admin?.email) { setError('We could not read your admin email. Sign in again.'); return; }
    if (form.next !== form.confirm) { setError('The new passwords do not match.'); return; }
    if (form.next.length < 8) { setError('Use at least 8 characters for the new password.'); return; }
    setBusy(true);
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email: admin.email, password: form.current });
    if (verifyError) { setBusy(false); setError('The current password is incorrect.'); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password: form.next });
    setBusy(false);
    if (updateError) { setError(updateError.message || 'We could not update the password. Try again.'); return; }
    setForm({ current: '', next: '', confirm: '' });
    setNotice('Admin password updated. Use it the next time you sign in.');
  };

  return <>
    <PageHeader kicker="Admin / settings" title="Settings" detail="Account security for the admin sign-in." action={<div className="flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/15 px-3 py-2 text-xs font-semibold text-primary"><ShieldCheck size={15} /> Admin only</div>} />
    <div className="grid gap-6">
      <section className="max-w-xl rounded-xl border border-border bg-card p-5">
        <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Account security</p>
        <h2 className="mt-1 font-display text-2xl font-bold">Reset admin password</h2>
        <p className="mt-2 text-sm text-muted-foreground">This changes the password you sign in with{admin?.email ? ` (${admin.email})` : ''}. Enter the current one to confirm it is you.</p>
        <form onSubmit={handlePassword} className="mt-5 grid gap-3">
          <PasswordField label="Current password" value={form.current} onChange={(e) => setForm((v) => ({ ...v, current: e.target.value }))} autoComplete="current-password" required data-testid="input-admin-current-password" toggleTestId="button-toggle-current-pwd" />
          <PasswordField label="New password" value={form.next} onChange={(e) => setForm((v) => ({ ...v, next: e.target.value }))} minLength={8} autoComplete="new-password" required data-testid="input-admin-new-password" toggleTestId="button-toggle-new-pwd" />
          <PasswordField label="Confirm new password" value={form.confirm} onChange={(e) => setForm((v) => ({ ...v, confirm: e.target.value }))} minLength={8} autoComplete="new-password" required data-testid="input-admin-confirm-new-password" toggleTestId="button-toggle-confirm-pwd" />
          <div className="flex justify-end"><Button type="submit" disabled={busy} data-testid="button-update-admin-password">{busy ? 'Updating…' : <><KeyRound size={15} /> Update password</>}</Button></div>
        </form>
        {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-admin-password-error">{error}</p>}
        {notice && <p className="mt-3 rounded-md bg-accent/15 px-3 py-2 text-sm font-medium text-primary" data-testid="status-admin-password-success">{notice}</p>}
      </section>

    </div>
  </>;
}

function useAdminSession(): CurrentUser | null {
  const [admin, setAdmin] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let alive = true;
    const resolve = (session: Session | null) => {
      const u = session?.user;
      const isAdmin = !!u && (isAdminEmail(u.email) || u.user_metadata?.role === 'admin');
      if (!alive) return;
      setAdmin(isAdmin ? { role: 'admin', displayName: String(u?.user_metadata?.display_name ?? 'Administrator'), email: u?.email ?? undefined, module: null, studentId: null } : null);
    };
    void supabase.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => resolve(session));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  return admin;
}

function randomPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (value) => chars[value % chars.length]).join('');
}

function Home() {
  const { data: user, isLoading } = useCurrentUser();
  const admin = useAdminSession();
  const login = useLogin();
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (user?.role === 'student') setLocation('/student'); }, [user, setLocation]);
  const handleSignIn = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    login.mutate({ data: { role: 'student', identifier, password } }, {
      onSuccess: (signInUser) => { queryClient.setQueryData(currentUserQueryKey('student'), signInUser); setLocation('/student'); },
      onError: () => setError('The credentials do not match our records.'),
    });
  };
  if (isLoading) return <LoadingScreen />;
  return <AuthLayout eyebrow="Entry point"><h1 className="font-display text-6xl font-bold tracking-tight text-primary text-center sm:text-7xl">WELCOME</h1><div className="mx-auto mt-8 w-full max-w-[340px]"><div className="rounded-xl border border-border bg-card p-5"><p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">Student</p><h2 className="mt-2 font-display text-2xl font-bold">Sign in to your record.</h2><form onSubmit={handleSignIn} className="mt-5 grid gap-3"><Field label="Login ID (email)" type="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@institute.edu" autoComplete="email" required data-testid="input-home-student-identifier" /><PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" required data-testid="input-home-student-password" toggleTestId="button-toggle-home-student-pwd" />{error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-home-error">{error}</p>}<Button type="submit" disabled={login.isPending} className="mt-1 w-full" data-testid="button-home-student-login">{login.isPending ? 'Signing in…' : 'Sign in'} <ArrowRight /></Button></form></div><p className="mt-4 text-center font-mono-ui text-xs uppercase tracking-[0.15em] text-muted-foreground">Login details are issued by your institute.</p></div></AuthLayout>;
}

function AdminLoginPage() {
  const [, setLocation] = useLocation();
  const admin = useAdminSession();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });

  useEffect(() => { if (admin) setLocation('/admin/dashboard'); }, [admin, setLocation]);

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
    setLoading(false);
    if (authError || !data.user) { setError('Invalid credentials. Please try again.'); return; }
    const u = data.user;
    if (!isAdminEmail(u.email) && u.user_metadata?.role !== 'admin') {
      setError('This account is not an administrator.');
      void supabase.auth.signOut();
    }
  };

  return <AuthLayout eyebrow="Admin Sign In">
    <div className="mb-8 flex items-center justify-between lg:hidden"><Logo /><Link href="/" className="text-sm font-semibold text-primary" data-testid="link-back-home">Back to home</Link></div>
    <Link href="/" className="mb-8 hidden items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground lg:flex" data-testid="link-back-home-lg"><ChevronLeft size={16} /> Back to home</Link>
    <p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">Welcome back</p>
    <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">Access your module desk.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Use the identifier your institute gave you.</p>
    <form onSubmit={handleSignIn} className="mt-7 grid gap-4">
      <Field label="Email" type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} placeholder="you@institute.edu" autoComplete="email" required data-testid="input-admin-identifier" />
      <PasswordField label="Password" value={form.password} onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))} placeholder="Enter password" autoComplete="current-password" required data-testid="input-admin-password" toggleTestId="button-toggle-admin-pwd" />
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-auth-error">{error}</p>}
      <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full" data-testid="button-submit-auth">{loading ? 'Signing in…' : 'Sign in'} <ArrowRight /></Button>
    </form>
    <p className="mt-6 text-center text-sm text-muted-foreground">Restricted access for administrators only.</p>
  </AuthLayout>;
}

function StudentAuthPage() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [message, setMessage] = useState('');
  const [signInForm, setSignInForm] = useState({ identifier: '', password: '' });

  const handleSignIn = (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    login.mutate({ data: { role: 'student', identifier: signInForm.identifier, password: signInForm.password } }, {
      onSuccess: (user) => { queryClient.setQueryData(currentUserQueryKey('student'), user); setLocation(dashboardPath(user.role)); },
      onError: () => setMessage('Invalid credentials. Please try again.'),
    });
  };

  return <AuthLayout eyebrow="Student Sign In">
    <div className="mb-8 flex items-center justify-between lg:hidden"><Logo /><Link href="/" className="text-sm font-semibold text-primary" data-testid="link-back-home">Back to home</Link></div>
    <Link href="/" className="mb-8 hidden items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground lg:flex" data-testid="link-back-home-lg"><ChevronLeft size={16} /> Back to home</Link>
    <p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">Welcome back</p>
    <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">Access your personal dashboard.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Use the login details your institute issued you.</p>
    <form onSubmit={handleSignIn} className="mt-7 grid gap-4">
      <Field label="Email" type="email" value={signInForm.identifier} onChange={(e) => setSignInForm({ ...signInForm, identifier: e.target.value })} placeholder="you@institute.edu" autoComplete="email" required data-testid="input-student-identifier" />
      <PasswordField label="Password" value={signInForm.password} onChange={(e) => setSignInForm({ ...signInForm, password: e.target.value })} placeholder="Enter password" autoComplete="current-password" required data-testid="input-student-password" toggleTestId="button-toggle-student-pwd" />
      {message && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-auth-error">{message}</p>}
      <Button type="submit" size="lg" disabled={login.isPending} className="mt-2 w-full" data-testid="button-submit-auth">{login.isPending ? 'Signing in…' : 'Sign in'} <ArrowRight /></Button>
    </form>
    <p className="mt-6 text-center text-sm text-muted-foreground">Login details are issued by your institute.</p>
  </AuthLayout>;
}


function useAdminBackendSession(enabled: boolean) {
  const { data: user, isLoading } = useCurrentUser();
  const admin = useAdminSession();
  const exchange = useLoginSupabaseAdmin();
  const [supaReady, setSupaReady] = useState(false);
  const [ready, setReady] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(() => { if (alive) setSupaReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange(() => { if (alive) setSupaReady(true); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (user?.role === 'admin') { attempted.current = true; setReady(true); return; }
    if (attempted.current) return;
    if (isLoading || !supaReady) return;
    if (!admin) { attempted.current = true; setReady(true); return; }
    attempted.current = true;
    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) { setReady(true); return; }
      exchange.mutate({ data: { token } }, {
        onSuccess: (adminUser) => { queryClient.setQueryData(currentUserQueryKey('admin'), adminUser); setReady(true); },
        onError: () => { void supabase.auth.signOut().finally(() => setReady(true)); },
      });
    });
  }, [enabled, user, admin, isLoading, supaReady, exchange]);

  return { admin: user?.role === 'admin' ? user : undefined, ready: user?.role === 'admin' ? true : ready };
}

function Protected({ role, children }: { role: Role; children: ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const adminSession = useAdminBackendSession(role === 'admin');
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (role === 'admin') { if (adminSession.ready && !adminSession.admin) setLocation('/admin'); return; }
    // Send them to this workspace's own sign-in, never to another role's dashboard.
    if (!isLoading && (!user || user.role !== role)) setLocation(role === 'teacher' ? '/admin/ai' : '/');
  }, [isLoading, user, role, adminSession, setLocation]);
  if (role === 'admin') {
    if (!adminSession.ready) return <LoadingScreen label="Opening your workspace" />;
    const adminUser = adminSession.admin;
    if (!adminUser) return <LoadingScreen label="Returning to sign in" />;
    return <Shell user={adminUser}>{children}</Shell>;
  }
  if (isLoading || !user || user.role !== role) return <LoadingScreen label={user ? 'Opening your workspace' : 'Returning to sign in'} />;
  return <Shell user={user}>{children}</Shell>;
}

function Router() {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={Home} /><Route path="/admin" component={AdminLoginPage} /><Route path="/admin/login" component={AdminLoginPage} /><Route path="/student/login" component={StudentAuthPage} /><Route path="/admin/dashboard"><Protected role="admin"><AdminModulesPage /></Protected></Route><Route path="/admin/dashboard/:module"><Protected role="admin"><AdminModuleReportPage /></Protected></Route><Route path="/admin/module/:module"><Protected role="admin"><ModuleDetailPage /></Protected></Route><Route path="/admin/settings"><Protected role="admin"><AdminSettingsPage /></Protected></Route><Route path="/admin/panel-logins"><Protected role="admin"><AdminPanelLoginsPage /></Protected></Route><Route path="/admin/students"><Protected role="admin"><AdminStudentsPage /></Protected></Route><Route path="/admin/students/enrolled"><Protected role="admin"><AdminEnrolledPage /></Protected></Route><Route path="/admin/students/:id"><Protected role="admin"><StudentDetailPage scope="admin" /></Protected></Route><Route path="/admin/announcements"><Protected role="admin"><AdminAnnouncementsFromRoute /></Protected></Route><Route path="/admin/documents"><Protected role="admin"><AdminDocumentsFromRoute /></Protected></Route><Route path="/admin/:panel"><ModulePanelRoute /></Route><Route path="/teacher/add-student"><Protected role="teacher"><TeacherAddStudentFromRoute /></Protected></Route><Route path="/teacher/attendance"><Protected role="teacher"><TeacherAttendanceFromRoute /></Protected></Route><Route path="/teacher/announcements"><Protected role="teacher"><TeacherAnnouncementsFromRoute /></Protected></Route><Route path="/teacher/documents"><Protected role="teacher"><TeacherDocumentsFromRoute /></Protected></Route><Route path="/teacher/students"><Protected role="teacher"><TeacherStudentListFromRoute /></Protected></Route><Route path="/teacher/students/:id"><Protected role="teacher"><StudentDetailPage scope="teacher" /></Protected></Route><Route path="/teacher"><Protected role="teacher"><TeacherPageFromRoute /></Protected></Route><Route path="/student/profile"><Protected role="student"><StudentProfileFromRoute /></Protected></Route><Route path="/student/modules"><Protected role="student"><StudentModulesPage /></Protected></Route><Route path="/student/project"><Protected role="student"><StudentProjectPage /></Protected></Route><Route path="/student/announcements"><Protected role="student"><StudentAnnouncementsPage /></Protected></Route><Route path="/student"><Protected role="student"><StudentPageFromRoute /></Protected></Route><Route path="/:panel"><ModulePanelRoute /></Route><Route component={() => <div className="grid min-h-[100dvh] place-items-center p-6"><div className="text-center"><p className="font-mono-ui text-xs uppercase tracking-wider text-primary">404</p><h1 className="mt-2 font-display text-4xl font-bold">Page not found</h1><Link href="/" className="mt-5 inline-flex text-sm font-semibold text-primary" data-testid="link-not-found-home">Return home <ArrowRight size={15} /></Link></div></div>} /></Switch></ErrorBoundary>;
}

function TeacherAddStudentFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <TeacherAddStudentPage user={user} /> : null;
}

function TeacherAnnouncementsFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <AnnouncementsPage user={user} scope="teacher" /> : null;
}

function AdminAnnouncementsFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <AnnouncementsPage user={user} scope="admin" /> : null;
}

function AdminDocumentsFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <CourseDocumentsPage user={user} scope="admin" /> : null;
}

function TeacherDocumentsFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <CourseDocumentsPage user={user} scope="teacher" /> : null;
}

function TeacherAttendanceFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <AttendanceRegisterPage user={user} /> : null;
}

function TeacherStudentListFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <TeacherStudentListPage user={user} /> : null;
}

function TeacherPageFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <TeacherPage user={user} /> : null;
}

function ModulePanel({ panel }: { panel: Module }) {
  const { data: user, isLoading } = useCurrentUser();
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (isLoading) return <LoadingScreen label="Opening your workspace" />;
  if (user?.role === 'teacher' && user.module === panel) return <Shell user={user}><TeacherPage user={user} /></Shell>;

  const handleSignIn = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    login.mutate({ data: { role: 'teacher', identifier, password } }, {
      onSuccess: (signInUser) => {
        queryClient.setQueryData(currentUserQueryKey('teacher'), signInUser);
        setLocation(signInUser.module && signInUser.module !== panel ? `/admin/${signInUser.module}` : `/admin/${panel}`);
      },
      onError: () => setError('These credentials are not valid for this panel.'),
    });
  };

  return <AuthLayout eyebrow="Module panel">
    <div className="mb-8 flex items-center justify-between lg:hidden"><Logo /><Link href="/" className="text-sm font-semibold text-primary" data-testid="link-back-home">Back to home</Link></div>
    <Link href="/" className="mb-8 hidden items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground lg:flex" data-testid="link-back-home-lg"><ChevronLeft size={16} /> Back to home</Link>
    <div className="inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/15 px-3 py-1.5 text-xs font-bold text-primary"><span className="h-2 w-2 rounded-full bg-accent" />{moduleShort[panel]} desk</div>
    <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">Sign in to your desk.</h1>
    <p className="mt-2 text-sm text-muted-foreground">{moduleNames[panel]} — module owners sign in with the owner ID issued from the admin panel.</p>
    <div className="mt-6 rounded-xl border border-border bg-card p-5">
      <p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">Module owner</p>
      <form onSubmit={handleSignIn} className="mt-4 grid gap-3">
        <Field label="Owner ID" type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. owner@ai" autoComplete="username" required data-testid={`input-panel-identifier-${panel}`} />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" required data-testid={`input-panel-password-${panel}`} toggleTestId={`button-toggle-panel-pwd-${panel}`} />
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid={`status-panel-error-${panel}`}>{error}</p>}
        <Button type="submit" disabled={login.isPending} className="mt-1 w-full" data-testid={`button-panel-login-${panel}`}>{login.isPending ? 'Signing in…' : 'Open desk'} <ArrowRight /></Button>
      </form>
    </div>
    <p className="mt-4 text-center font-mono-ui text-xs uppercase tracking-[0.15em] text-muted-foreground">Login details are issued by your institute.</p>
  </AuthLayout>;
}

function ModulePanelRoute() {
  const params = useParams<{ panel: string }>();
  const raw = (params.panel ?? '').toLowerCase();
  const valid = (modules as readonly string[]).includes(raw);
  if (!valid) return <div className="grid min-h-[100dvh] place-items-center p-6"><div className="text-center"><p className="font-mono-ui text-xs uppercase tracking-wider text-primary">404</p><h1 className="mt-2 font-display text-4xl font-bold">Panel not found</h1><Link href="/" className="mt-5 inline-flex text-sm font-semibold text-primary" data-testid="link-not-found-home">Return home <ArrowRight size={15} /></Link></div></div>;
  return <ModulePanel panel={raw as Module} />;
}

function StudentPageFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <StudentPage user={user} /> : null;
}

function StudentProfileFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <StudentProfilePage user={user} /> : null;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;

