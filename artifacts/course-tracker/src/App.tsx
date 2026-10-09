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
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Eye,
  EyeOff,
  FileText,
  GitBranch,
  GraduationCap,
  Image as ImageIcon,
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
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import zedkingLogo from './assets/zedking-logo.png';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { validateStudentEmail } from '@/lib/email-validation';

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
  if (path.startsWith('/branch')) return 'branch';
  if (path === '/admin' || path.startsWith('/admin/')) {
    // Under /admin, only the fixed admin routes belong to the admin desk; everything
    // else (a module panel key like /admin/ai or /admin/seo) is a module owner route.
    const segment = path.split('/')[2] ?? '';
    if (segment === '' || KNOWN_ADMIN_SEGMENTS.has(segment)) return 'admin';
    return 'teacher';
  }
  // Module panels also sit at /<module> on the student/entry path? No — but keep the
  // original check for standalone module keys.
  if (modules.some((m) => path === `/${m}`)) return 'teacher';
  // The entry page carries the student sign-in form, so resolve it as the student
  // workspace — otherwise /auth/me falls back to whichever session happens to exist.
  if (path === '/') return 'student';
  return null;
}

// Fixed admin routes under /admin. Anything else under /admin is a module panel key.
const KNOWN_ADMIN_SEGMENTS = new Set([
  'dashboard', 'module', 'settings', 'panel-logins', 'students',
  'announcements', 'documents', 'branch', 'branches', 'login',
]);

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
const roleRoutes: Record<Role, string> = { admin: '/admin/dashboard', teacher: '/teacher', student: '/student', branch: '/branch' };
function dashboardPath(role: Role | null | undefined): string {
  return role ? roleRoutes[role] : '/';
}

const adminModules: { key: Module; number: number; name: string; tagline: string }[] = [
  { key: 'ai', number: 1, name: 'Artificial Intelligence', tagline: 'Automation, forecasting, and AI-driven insight across your portfolio.' },
  { key: 'dm', number: 2, name: 'Digital Marketing', tagline: 'Campaigns, reach, and conversions measured in one calm view.' },
  { key: 'sm', number: 3, name: 'Social Media', tagline: 'Presence, engagement, and community growth at a glance.' },
];

// Branches and their modules are defined by the admin panel, not hard-coded. The
// catalog is loaded once for the whole app; while it is loading (or if the call
// fails) the static three-module default above keeps every screen working.
type BranchSummary = { id: number; name: string; modules: { id: string; name: string }[]; username?: string | null; plainPassword?: string | null };

const catalogTaglines: Record<string, string> = {
  ai: 'Automation, forecasting, and AI-driven insight across your portfolio.',
  dm: 'Campaigns, reach, and conversions measured in one calm view.',
  sm: 'Presence, engagement, and community growth at a glance.',
};

let branchCatalog: BranchSummary[] | null = null;
let branchCatalogPromise: Promise<void> | null = null;
const branchCatalogListeners = new Set<() => void>();

function loadBranchCatalog(): Promise<void> {
  if (branchCatalogPromise) return branchCatalogPromise;
  branchCatalogPromise = fetch('/api/catalog/branches')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (Array.isArray(data)) {
        branchCatalog = data as BranchSummary[];
        // Keep the flat name maps in step so labels resolve for new modules too.
        for (const branch of branchCatalog) {
          for (const mod of branch.modules) {
            if (!moduleNames[mod.id]) moduleNames[mod.id] = mod.name;
            if (!moduleShort[mod.id]) moduleShort[mod.id] = mod.id.toUpperCase().slice(0, 6);
          }
        }
        branchCatalogListeners.forEach((fn) => fn());
      }
    })
    .catch(() => undefined);
  return branchCatalogPromise;
}

function refreshBranchCatalog(): Promise<void> {
  branchCatalogPromise = null;
  return loadBranchCatalog();
}

function useBranches(): BranchSummary[] | null {
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    const listener = () => { if (alive) bump((v) => v + 1); };
    branchCatalogListeners.add(listener);
    void loadBranchCatalog();
    return () => { alive = false; branchCatalogListeners.delete(listener); };
  }, []);
  return branchCatalog;
}

function useCatalogModules(): typeof adminModules {
  const branches = useBranches();
  if (!branches) return adminModules;
  const metas: typeof adminModules = [];
  let number = 0;
  for (const branch of branches) {
    for (const mod of branch.modules) {
      number += 1;
      metas.push({
        key: mod.id,
        number,
        name: mod.name,
        tagline: catalogTaglines[mod.id] ?? `Part of the ${branch.name} branch.`,
      });
    }
  }
  return metas.length ? metas : adminModules;
}

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
function documentHref(scope: 'admin' | 'teacher' | 'student' | 'branch', doc: CourseDocument): string {
  return `/api/${scope}/documents/${doc.module}/${doc.kind}/file?v=${encodeURIComponent(doc.updatedAt)}`;
}

function useCourseDocuments(scope: 'admin' | 'teacher' | 'student' | 'branch') {
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
function DocLink({ scope, kind, doc }: { scope: 'admin' | 'teacher' | 'student' | 'branch'; kind: DocumentKind; doc?: CourseDocument }) {
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
      { href: '/admin/branches', label: 'Branches', icon: GitBranch },
      { href: '/admin/students', label: 'Add student', icon: Users, children: [{ href: '/admin/students/enrolled', label: 'Student list', icon: UserCheck }] },
      { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
      { href: '/admin/documents', label: 'Course files', icon: FileText },
    ]
  : user.role === 'teacher'
    ? [
        { href: `/admin/${user.module ?? 'ai'}`, label: 'Module desk', icon: ClipboardCheck },
        { href: '/teacher/add-student', label: 'Add student', icon: Users, children: [{ href: '/teacher/students', label: 'Student list', icon: UserCheck }] },
        { href: '/teacher/attendance', label: 'Mark Attendance', icon: CalendarCheck2 },
        { href: '/teacher/assessment', label: 'Mark Assessment', icon: ClipboardCheck },
        { href: '/teacher/announcements', label: 'Announcements', icon: Megaphone },
        { href: '/teacher/documents', label: 'Course files', icon: FileText },
      ]
    : user.role === 'branch'
      ? [
          { href: '/branch', label: `${user.displayName || 'Branch'} dashboard`, icon: LayoutDashboard },
          { href: '/branch/add-student', label: 'Add student', icon: Users, children: [{ href: '/branch/students', label: 'Student list', icon: UserCheck }] },
          { href: '/branch/documents', label: 'Course files', icon: FileText },
          { href: '/branch/announcements', label: 'Announcements', icon: Megaphone },
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
      logout.mutate(undefined, { onSettled: () => finish('/admin') });
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

function PageHeader({ kicker, title, detail, action }: { kicker: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2"><button type="button" onClick={() => window.history.back()} className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground" title="Back" aria-label="Back" data-testid="button-page-back"><ChevronLeft size={16} /></button><p className="font-mono-ui text-[10px] uppercase tracking-[0.22em] text-primary">{kicker}</p></div><h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl" data-testid="text-page-title">{title}</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">{detail}</p></div>{action}</div>;
}

function StatCard({ label, value, detail, icon: Icon, accent = false }: { label: string; value: string | number; detail: string; icon: typeof Users; accent?: boolean }) {
  return <div className={`rounded-xl border p-5 ${accent ? 'border-accent/40 bg-accent/15' : 'border-border bg-card'}`}><div className="flex items-center justify-between"><span className={`grid h-9 w-9 place-items-center rounded-lg ${accent ? 'bg-accent text-primary' : 'bg-muted text-primary'}`}><Icon size={17} /></span><span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span></div><p className="mt-7 font-display text-4xl font-bold" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

type AdminBranch = {
  id: number;
  name: string;
  username: string | null;
  plainPassword: string | null;
  modules: { id: string; name: string }[];
};

function AdminModulesPage() {
  const branches = useBranches();
  return <>
    <PageHeader kicker="Admin / branches" title="Branches." detail="Each branch runs its own modules. Open a branch to see its modules and reset its desk login." />
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {branches == null
        ? [1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-muted" />)
        : branches.map((branch, index) => (
          <Link key={branch.id} href={`/admin/branch/${branch.id}`} className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition hover:border-accent/60" data-testid={`card-branch-${branch.id}`}>
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent via-primary/30 to-transparent" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Branch</p>
                <h2 className="mt-1 font-display text-2xl font-bold leading-tight">{branch.name}</h2>
              </div>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted font-mono-ui text-xs font-bold text-primary">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="rounded-full bg-muted px-3 py-1 font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{branch.modules.length} module{branch.modules.length === 1 ? '' : 's'}</span>
              <ArrowRight size={16} className="text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
            </div>
          </Link>
        ))}
      {branches != null && branches.length === 0 && <p className="md:col-span-2 xl:col-span-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">           No branches yet — create one below.</p>}
    </div>
  </>;
}

function AdminBranchesPage() {
  const [branches, setBranches] = useState<AdminBranch[] | null>(null);
  const loadAdminBranches = () => {
    fetch('/api/admin/branches')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data)) setBranches(data as AdminBranch[]); })
      .catch(() => undefined);
  };
  useEffect(() => { loadAdminBranches(); }, []);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editPasswordShown, setEditPasswordShown] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [revealedIds, setRevealedIds] = useState<number[]>([]);
  const [pendingRevealId, setPendingRevealId] = useState<number | null>(null);
  const [confirmPwd, setConfirmPwd] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchUserId, setBranchUserId] = useState('');
  const [branchPassword, setBranchPassword] = useState('');
  const [branchPasswordShown, setBranchPasswordShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const createBranch = (event: FormEvent) => {
    event.preventDefault();
    const name = branchName.trim();
    if (!name) return;
    if (branchUserId.trim() && branchPassword.length > 0 && branchPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    fetch('/api/admin/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username: branchUserId.trim() || undefined, password: branchUserId.trim() ? branchPassword : undefined }),
    })
      .then((res) => res.json().then((data: { error?: string }) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.error ?? 'create failed');
        setNotice(`Branch "${name}" created${branchUserId.trim() ? ` with desk login "${branchUserId.trim()}"` : ''}.`);
        setBranchName(''); setBranchUserId(''); setBranchPassword('');
        void refreshBranchCatalog().then(() => loadAdminBranches());
      })
      .catch((err: Error) => setError(err.message === 'create failed' ? 'Could not create that branch.' : err.message))
      .finally(() => setBusy(false));
  };

  const saveEditBranch = (branchId: number) => {
    if (!editName.trim()) {
      setEditError('Enter a name.');
      return;
    }
    if (editPassword.trim() && editPassword.length < 6) {
      setEditError('Password must be at least 6 characters.');
      return;
    }
    setEditBusy(true); setEditError('');
    fetch(`/api/admin/branches/${branchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), username: editUsername.trim() }),
    })
      .then((res) => res.json().then((data: { error?: string }) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error((data as { error?: string })?.error ?? 'Could not save.');
        const done = () => {
          setEditingId(null); setEditError('');
          setNotice(`Branch updated.`);
          void refreshBranchCatalog().then(() => loadAdminBranches());
        };
        if (editPassword.trim()) {
          return fetch(`/api/admin/branches/${branchId}/credential`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: editPassword }),
          })
            .then((res) => res.json().then((data: { error?: string }) => ({ ok: res.ok, data })))
            .then(({ ok, data }) => {
              if (!ok) throw new Error((data as { error?: string })?.error ?? 'Could not update password.');
              done();
            });
        }
        done();
        return;
      })
      .catch((err: Error) => setEditError(err.message))
      .finally(() => setEditBusy(false));
  };

  const confirmReveal = () => {
    if (pendingRevealId === null || !confirmPwd) return;
    setConfirmBusy(true); setConfirmError('');
    void fetch('/api/admin/account/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: confirmPwd }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('The admin password is incorrect.');
        setRevealedIds((ids) => (ids.includes(pendingRevealId) ? ids : [...ids, pendingRevealId!]));
        setPendingRevealId(null); setConfirmPwd('');
      })
      .catch((err: Error) => setConfirmError(err instanceof Error ? err.message : 'The admin password is incorrect.'))
      .finally(() => setConfirmBusy(false));
  };

  const confirmDeleteBranch = (branchId: number) => {
    setEditBusy(true); setEditError('');
    fetch(`/api/admin/branches/${branchId}`, { method: 'DELETE' })
      .then((res) => (res.ok ? undefined : res.json().then((data: { error?: string }) => { throw new Error((data as { error?: string })?.error ?? 'delete failed'); })))
      .then(() => {
        setDeletingId(null);
        setNotice('Branch deleted.');
        void refreshBranchCatalog().then(() => loadAdminBranches());
      })
      .catch((err: Error) => setEditError(err.message))
      .finally(() => setEditBusy(false));
  };

  return <>
    <PageHeader kicker="Admin / branches" title="Branches." detail="Create a branch with its desk login, then open it to manage its modules." />
    <section className="rounded-xl border border-border bg-card p-5" data-testid="card-create-branch">
      <h3 className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Create branch</h3>
      <form onSubmit={createBranch} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1.5 text-sm font-medium">Name
          <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="e.g. HASC" data-testid="input-branch-name" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">User ID
          <Input value={branchUserId} onChange={(e) => setBranchUserId(e.target.value)} placeholder="e.g. hasc" autoComplete="off" data-testid="input-branch-user-id" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">Password
          <span className="flex items-center gap-2">
            <Input type={branchPasswordShown ? 'text' : 'password'} value={branchPassword} onChange={(e) => setBranchPassword(e.target.value)} placeholder="Min. 6 characters" autoComplete="new-password" data-testid="input-branch-password" />
            <button type="button" onClick={() => setBranchPasswordShown((v) => !v)} className="rounded p-1 text-muted-foreground hover:text-foreground" data-testid="button-toggle-branch-password">{branchPasswordShown ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </span>
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={busy || !branchName.trim()} data-testid="button-create-branch"><Plus size={15} /> Create branch</Button>
        </div>
      </form>
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-create-branch-error">{error}</p>}
      {notice && <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-create-branch-success">{notice}</p>}
    </section>

    <h3 className="mt-8 font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Existing branches</h3>
    <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {branches == null
        ? [1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)
        : branches.map((branch, index) => (
          <section key={branch.id} className="relative rounded-xl border border-border bg-card p-5 space-y-4" data-testid={`card-branch-${branch.id}`}>
            <div className="absolute right-3 top-3 flex items-center gap-1">
              <button type="button" onClick={() => { setEditingId(branch.id); setEditName(branch.name); setEditUsername(branch.username ?? ''); setEditError(''); }} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit" aria-label="Edit" data-testid={`button-edit-branch-${branch.id}`}><Pencil size={15} /></button>
              <button type="button" onClick={() => setDeletingId(branch.id)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label="Delete" data-testid={`button-delete-branch-${branch.id}`}><Trash2 size={15} /></button>
            </div>
            <div className="pr-20">
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">{String(index + 1).padStart(2, '0')}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-bold leading-tight truncate">{branch.name}</h2>
                <Link href={`/admin/branch/${branch.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" data-testid={`link-open-branch-${branch.id}`}>Open <ArrowRight size={12} /></Link>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{branch.modules.length} module{branch.modules.length === 1 ? '' : 's'} · User ID: {branch.username ?? 'not set'}</p>
            </div>
            {editingId === branch.id && (
              <form onSubmit={(e) => { e.preventDefault(); saveEditBranch(branch.id); }} className="mt-3 grid gap-3 rounded-lg border border-border bg-muted/40 p-3" data-testid={`form-edit-branch-${branch.id}`}>
                <label className="grid gap-1 text-xs font-medium">Name
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} data-testid={`input-branch-name-${branch.id}`} />
                </label>
                <label className="grid gap-1 text-xs font-medium">User ID
                  <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} data-testid={`input-branch-username-${branch.id}`} />
                </label>
                <label className="grid gap-1 text-xs font-medium">Password <span className="font-normal text-muted-foreground">(leave empty to keep the current one)</span>
                  <div className="relative">
                    <Input type={editPasswordShown ? 'text' : 'password'} value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="New password" minLength={6} autoComplete="new-password" data-testid={`input-branch-password-${branch.id}`} />
                    <button type="button" onClick={() => setEditPasswordShown((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" tabIndex={-1} data-testid={`button-toggle-branch-password-${branch.id}`}>{editPasswordShown ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  </div>
                </label>
                {editError && <p className="text-xs text-destructive" data-testid={`status-edit-branch-error-${branch.id}`}>{editError}</p>}
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={editBusy || !editName.trim()} data-testid={`button-save-branch-edit-${branch.id}`}>Save</Button>
                  <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => { setEditingId(null); setEditError(''); }}>Cancel</button>
                </div>
              </form>
            )}
            {deletingId === branch.id && (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid={`confirm-delete-branch-${branch.id}`}>
                <p className="text-sm font-semibold text-destructive">Delete branch?</p>
                <p className="mt-1 text-xs text-muted-foreground">This removes its login and module links. Students already enrolled are kept, but their branch becomes unassigned.</p>
                <div className="mt-3 flex items-center gap-2">
                  <Button type="button" size="sm" variant="destructive" onClick={() => confirmDeleteBranch(branch.id)} data-testid={`button-confirm-delete-${branch.id}`}>Delete</Button>
                  <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => setDeletingId(null)}>Cancel</button>
                </div>
              </div>
            )}
            <div className="mt-4 border-t border-border/70 pt-4 space-y-2">
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Desk password</p>
              <p className="text-xs text-muted-foreground">
                Password: <b className="text-foreground" data-testid={`text-branch-password-${branch.id}`}>{revealedIds.includes(branch.id) ? (branch.plainPassword ?? '—') : '••••••••'}</b>{' '}
                <button type="button" onClick={() => { if (revealedIds.includes(branch.id)) { setRevealedIds((ids) => ids.filter((id) => id !== branch.id)); } else { setPendingRevealId(branch.id); setConfirmPwd(''); setConfirmError(''); } }} className="rounded p-1 align-middle text-muted-foreground hover:text-foreground" data-testid={`button-toggle-branch-password-${branch.id}`} aria-label={revealedIds.includes(branch.id) ? 'Hide password' : 'Reveal password'}>{revealedIds.includes(branch.id) ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              </p>
            </div>
          </section>
        ))}
      {pendingRevealId !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-primary/30 p-4" data-testid="modal-admin-branch-confirm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-lg">
            <h3 className="font-display text-lg font-bold">Reveal desk password</h3>
            <p className="mt-1 text-sm text-muted-foreground">Confirm with the admin password to show this branch's desk password.</p>
            <form onSubmit={(e) => { e.preventDefault(); confirmReveal(); }} className="mt-4 grid gap-3">
              <PasswordField label="Admin password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoFocus required data-testid="input-branch-admin-confirm-password" toggleTestId="button-toggle-branch-admin-confirm-pwd" />
              {confirmError && <p className="text-xs text-destructive" data-testid="status-branch-admin-confirm-error">{confirmError}</p>}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={confirmBusy || !confirmPwd.trim()} data-testid="button-confirm-branch-reveal">Reveal</Button>
                <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => { setPendingRevealId(null); setConfirmPwd(''); setConfirmError(''); }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {branches != null && branches.length === 0 && <p className="md:col-span-2 lg:col-span-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No branches yet — create your first one above.</p>}
    </div>
  </>;
}

function AdminBranchLoginCard({ branch, onChanged }: { branch: BranchSummary; onChanged: () => void }) {
  const [pwdOpen, setPwdOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [newPwdShown, setNewPwdShown] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | 'reveal' | 'password' | 'reset'>(null);
  const [confirmPwd, setConfirmPwd] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [credUserId, setCredUserId] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credShow, setCredShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const saveCredential = (event: FormEvent) => {
    event.preventDefault();
    if (!credUserId.trim() || credPassword.length < 6) {
      setError('Enter a user ID and a password of at least 6 characters.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    fetch(`/api/admin/branches/${branch.id}/credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: credUserId.trim(), password: credPassword }),
    })
      .then((res) => res.json().then((data: { error?: string }) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error((data as { error?: string })?.error || 'create failed');
        setNotice(`Desk login created — user ID ${credUserId.trim()}, password ${credPassword}`);
        setCredUserId(''); setCredPassword('');
        onChanged();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const saveNewPassword = (event: FormEvent) => {
    event.preventDefault();
    if (newPwd.trim().length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    fetch(`/api/admin/branches/${branch.id}/credential`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPwd }),
    })
      .then((res) => res.json().then((data: { error?: string }) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error((data as { error?: string })?.error || 'update failed');
        setNotice('Password updated.');
        setPwdOpen(false); setNewPwd('');
        onChanged();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const verifyAdmin = () => {
    if (!pendingAction || !confirmPwd) return;
    const action = pendingAction;
    setConfirmBusy(true); setConfirmError('');
    fetch('/api/admin/account/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: confirmPwd }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('The admin password is incorrect.');
        if (action === 'reveal') {
          setRevealed(true);
        } else if (action === 'password') {
          setPwdOpen(true); setNewPwd(''); setNewPwdShown(false);
        } else {
          const password = randomPassword();
          setBusy(true);
          fetch(`/api/admin/branches/${branch.id}/credential`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          })
            .then((res) => res.json().then((data: { error?: string }) => ({ ok: res.ok, data })))
            .then(({ ok }) => {
              if (!ok) throw new Error('The reset did not take. Try again.');
              setNotice(`Password reset — user ID ${branch.username ?? ''}, new password ${password}`);
              onChanged();
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
        }
        setPendingAction(null); setConfirmPwd('');
      })
      .catch((err: Error) => setConfirmError(err.message))
      .finally(() => setConfirmBusy(false));
  };

  return <>
    <section className="mt-6 rounded-xl border border-border bg-card p-5" data-testid={`card-branch-login-${branch.id}`}>
      <h3 className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Branch desk login</h3>
      {branch.username ? (
        <div className="mt-3 grid gap-1.5 text-sm sm:max-w-sm">
          <p>User ID: <span className="font-bold text-foreground" data-testid={`text-branch-username-${branch.id}`}>{branch.username}</span></p>
          <p className="flex items-center gap-2">Password:
            <span className="font-bold text-foreground" data-testid={`text-branch-password-${branch.id}`}>{revealed ? (branch.plainPassword ?? '—') : '••••••••'}</span>
            <button type="button" onClick={() => { if (revealed) { setRevealed(false); } else { setConfirmPwd(''); setConfirmError(''); setPendingAction('reveal'); } }} className="rounded p-1 text-muted-foreground hover:text-foreground" data-testid={`button-toggle-branch-password-${branch.id}`}>{revealed ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </p>
          {pwdOpen ? (
            <form onSubmit={saveNewPassword} className="mt-2 flex flex-wrap items-center gap-2" data-testid={`form-change-branch-password-${branch.id}`}>
              <div className="relative flex-1">
                <Input type={newPwdShown ? 'text' : 'password'} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="New password" autoFocus data-testid={`input-new-branch-password-${branch.id}`} />
                <button type="button" onClick={() => setNewPwdShown((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" data-testid={`button-toggle-new-branch-password-${branch.id}`}>{newPwdShown ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
              <Button type="submit" size="sm" disabled={busy || !newPwd.trim()} data-testid={`button-save-new-branch-password-${branch.id}`}>Save</Button>
              <button type="button" onClick={() => { setPwdOpen(false); setNewPwd(''); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
            </form>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => { setConfirmPwd(''); setConfirmError(''); setPendingAction('password'); }} data-testid={`button-change-branch-password-${branch.id}`}>Change password</button>
              <button type="button" className="text-xs font-semibold text-destructive hover:underline" onClick={() => { setConfirmPwd(''); setConfirmError(''); setPendingAction('reset'); }} data-testid={`button-reset-branch-password-${branch.id}`}>Reset to random</button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={saveCredential} className="mt-3 grid gap-2 sm:max-w-sm" data-testid={`form-branch-credential-${branch.id}`}>
          <Input value={credUserId} onChange={(e) => setCredUserId(e.target.value)} placeholder="User ID (e.g. hasc)" data-testid={`input-branch-username-${branch.id}`} />
          <div className="flex items-center gap-2">
            <Input type={credShow ? 'text' : 'password'} value={credPassword} onChange={(e) => setCredPassword(e.target.value)} placeholder="Password" className="flex-1" data-testid={`input-branch-password-${branch.id}`} />
            <button type="button" onClick={() => setCredShow((v) => !v)} className="rounded p-1 text-muted-foreground hover:text-foreground" data-testid={`button-toggle-branch-password-input-${branch.id}`}>{credShow ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
          <Button type="submit" size="sm" disabled={busy || !credUserId.trim() || credPassword.length < 6} data-testid={`button-save-branch-login-${branch.id}`}><Plus size={14} /> Create login</Button>
        </form>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Branch login page: <span className="font-mono font-semibold text-foreground">/{branch.name.toLowerCase().replace(/\s+/g, '-')}</span></p>
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid={`status-branch-login-error-${branch.id}`}>{error}</p>}
      {notice && <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid={`status-branch-login-success-${branch.id}`}>{notice}</p>}
    </section>
    {pendingAction && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-primary/30 p-4" data-testid="modal-branch-confirm">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Admin verification</p>
          <h3 className="mt-1 font-display text-xl font-bold">{pendingAction === 'reveal' ? 'See branch password' : pendingAction === 'password' ? 'Change branch password' : 'Reset branch password'}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{pendingAction === 'reveal' ? `Enter your admin password to see the password for ${branch.name}.` : pendingAction === 'password' ? `Enter your admin password to set a new password for ${branch.name}.` : `Enter your admin password to reset the login for ${branch.name}.`}</p>
          <form onSubmit={(e) => { e.preventDefault(); verifyAdmin(); }} className="mt-4 grid gap-3">
            <PasswordField label="Admin password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoFocus required data-testid="input-branch-admin-confirm-password" toggleTestId="button-toggle-branch-admin-confirm-pwd" />
            {confirmError && <p className="text-xs text-destructive" data-testid="status-branch-admin-confirm-error">{confirmError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setConfirmPwd(''); setConfirmError(''); setPendingAction(null); }} disabled={confirmBusy} data-testid="button-cancel-branch-confirm">Cancel</Button>
              <Button type="submit" size="sm" disabled={confirmBusy || !confirmPwd} data-testid="button-submit-branch-confirm">{confirmBusy ? 'Verifying…' : pendingAction === 'reset' ? 'Reset login' : 'Confirm'}</Button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>;
}

function AdminBranchPage() {
  const params = useParams<{ id: string }>();
  const branchId = Number(params.id);
  const [branches, setBranches] = useState<AdminBranch[] | null>(null);
  const [moduleName, setModuleName] = useState('');
  const [addingModule, setAddingModule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadBranches = () => {
    fetch('/api/admin/branches')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data)) setBranches(data as AdminBranch[]); })
      .catch(() => undefined);
  };
  useEffect(() => { loadBranches(); }, []);
  const branch = branches?.find((b) => b.id === branchId) ?? null;

  const createModule = (event: FormEvent) => {
    event.preventDefault();
    if (!moduleName.trim() || !branch) return;
    setBusy(true); setError(''); setNotice('');
    fetch('/api/admin/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId: branch.id, name: moduleName.trim() }),
    })
      .then((res) => res.json().then((data: { error?: string }) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error((data as { error?: string })?.error || 'create failed');
        setNotice(`Module "${moduleName.trim()}" added.`);
        setModuleName(''); setAddingModule(false);
        void refreshBranchCatalog().then(loadBranches);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  if (branches != null && !branch) {
    return <>
      <PageHeader kicker="Admin / branches" title="Branch not found." detail="That branch does not exist." />
      <Link href="/admin/dashboard" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-muted" data-testid="link-back-to-branches"><ChevronLeft size={14} /> Back to branches</Link>
    </>;
  }

  return <>
    <PageHeader kicker="Admin / branches" title={branch ? branch.name : 'Branch'} detail={branch ? `${branch.modules.length} module${branch.modules.length === 1 ? '' : 's'} in this branch.` : 'Loading…'} />
    {error && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-branch-page-error">{error}</p>}
    {notice && <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-branch-page-success">{notice}</p>}
    <section className="rounded-xl border border-border bg-card p-5" data-testid={`card-branch-modules-${branch?.id ?? 'loading'}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Modules</h3>
        <button type="button" onClick={() => { setAddingModule((v) => !v); setModuleName(''); setError(''); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline" data-testid="button-branch-add-module-toggle"><Plus size={13} /> Add module</button>
      </div>
      {addingModule && (
        <form onSubmit={createModule} className="mt-4 flex flex-wrap items-end gap-3" data-testid="form-add-module">
          <label className="grid gap-1.5 text-sm font-medium">Module name
            <Input value={moduleName} onChange={(e) => setModuleName(e.target.value)} placeholder="e.g. Artificial Intelligence" autoFocus className="w-64" data-testid="input-module-name" />
          </label>
          <Button type="submit" size="sm" disabled={busy || !moduleName.trim()} data-testid="button-add-module-save">Add module</Button>
          <button type="button" onClick={() => { setAddingModule(false); setModuleName(''); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
        </form>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(branch?.modules ?? []).map((mod) => (
          <Link key={mod.id} href={`/admin/module/${mod.id}`} className="group flex flex-col rounded-lg border border-border bg-background p-4 transition hover:border-accent/60" data-testid={`card-branch-module-${mod.id}`}>
            <span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">{mod.id.toUpperCase()}</span>
            <h3 className="mt-2 font-display text-lg font-bold leading-tight">{mod.name}</h3>
            <span className="mt-3 inline-flex w-fit items-center gap-1.5 font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground group-hover:text-primary">Open module <ArrowRight size={13} /></span>
          </Link>
        ))}
        {branch != null && branch.modules.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">No modules yet — add the first one above.</p>}
        {branches == null && [1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
      </div>
    </section>
  </>;
}

function AdminModuleReportPage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as Module;
  const catalog = useCatalogModules();
  const meta = catalog.find((m) => m.key === moduleKey);
  const [monthKey, setMonthKey] = useState(() => todayIso().slice(0, 7));
  const [summary, setSummary] = useState<{ month: string; months: string[]; totalStudents: number; marked: number; expected: number; pending: number; assessmentMarked: number; projects: { project: number; marked: number }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/modules/${moduleKey}/attendance/summary?month=${monthKey}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setSummary(data); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [moduleKey, monthKey]);
  if (!meta) return <><PageHeader kicker="Admin / module reports" title="Module not found." detail="That module does not exist." /></>;
  const total = summary?.totalStudents ?? 0;
  const expected = summary?.expected ?? 0;
  const projects = summary?.projects ?? [];
  const projectsMeta = projects.map((p, i) => {
    const status = total > 0 && p.marked === total ? 'Submitted' : p.marked > 0 ? 'Partial' : 'Pending';
    return { ...p, index: i + 1, status };
  });
  return <>
    <PageHeader kicker={`Admin / ${moduleShort[moduleKey]} report`} title={`${meta.name}`} detail="Live status for this module — cohort size, register coverage, and the month's projects." action={<label className="grid gap-1.5 text-sm font-medium">Month<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} data-testid="select-report-month">{(summary?.months ?? [todayIso().slice(0, 7)]).map((m) => <option key={m} value={m}>{monthNameFromKey(m)}</option>)}</select></label>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Students" value={total} detail="enrolled this month" icon={Users} accent /><StatCard label="Attendance marked" value={summary ? `${summary.marked}/${expected}` : '—'} detail="records captured this month" icon={CalendarCheck2} /><StatCard label="Attendance pending" value={summary?.pending ?? '—'} detail="records yet to be filled" icon={Clock} /><StatCard label="Project entries" value={summary?.assessmentMarked ?? '—'} detail="marks entered this month" icon={ClipboardCheck} /></div>
    <section className="mt-8 rounded-xl border border-border bg-card p-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">This month</p><h2 className="mt-1 font-display text-2xl font-bold">Projects status</h2><p className="mt-2 text-sm text-muted-foreground">Whether each of the month's two projects has been submitted by the module owner.</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2">{summary === null || !summary ? [1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />) : projectsMeta.map((p) => <div key={p.project} className="rounded-xl border border-border p-5" data-testid={`project-${p.index}`}><div className="flex items-center justify-between"><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Project {p.index}</p><span className={`rounded-full px-2.5 py-1 font-mono-ui text-[10px] ${p.status === 'Submitted' ? 'bg-accent/20 text-primary' : p.status === 'Partial' ? 'bg-muted text-foreground' : 'bg-destructive/10 text-destructive'}`}>{p.status}</span></div><h3 className="mt-2 font-display text-xl font-bold">{monthNameFromKey(monthKey)} · project {p.project}</h3><p className="mt-1 text-sm text-muted-foreground">{p.marked} of {total} students submitted</p></div>)}</div></section>
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
  const catalog = useCatalogModules();
  const ownersFor = (module: Module) => (teachers.data ?? []).filter((t) => t.module === module);
  return <>
    <PageHeader kicker="Admin / panel access" title="Create panel logins yourself." detail="Logins are created from each module's own page. A module can hold several, and each owner can only open their own module desk." />
    <div className="grid gap-4 lg:grid-cols-3">{catalog.map((m) => <OwnerLoginCard key={m.key} m={m} owners={ownersFor(m.key)} />)}</div>
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
  const catalog = useCatalogModules();
  const meta = catalog.find((m) => m.key === moduleKey);
  const teachers = useListTeachers();
  const create = useCreateTeacher();
  const update = useUpdateTeacher();
  const remove = useDeleteTeacher();

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

  // Seeing a password, changing one and deleting a login all require the admin's
  // own password, confirmed server-side (Supabase, with an admins-hash fallback).
  const verifyAdmin = () => {
    if (!pending || !confirmPwd) return;
    const target = pending.teacher;
    const action = pending.type;
    setConfirmBusy(true); setConfirmError('');
    void fetch('/api/admin/account/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: confirmPwd }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('The admin password is incorrect.');
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
  const [monthKey, setMonthKey] = useState(() => todayIso().slice(0, 7));
  const [summary, setSummary] = useState<{ months: string[]; studentsMarked: number; studentsPending: number; assessmentMarked: number; totalStudents: number; projects: { project: number; marked: number }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    setSummary(null);
    fetch(`/api/admin/modules/${moduleKey}/attendance/summary?month=${monthKey}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setSummary(data); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [moduleKey, monthKey]);

  // "How many students are still missing" is the question this section answers, so
  // say it in students — not a bare Updated/Pending badge.
  const total = summary?.totalStudents ?? 0;
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
        <p className="mt-2 max-w-md text-sm text-muted-foreground">How many students this module marked on a day, and how many projects were due by it. The day view follows the month pick above.</p>
      </div>
      <label className="grid gap-1.5 text-sm font-medium">Month<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} data-testid="select-status-month">{(summary?.months ?? [todayIso().slice(0, 7)]).map((m) => <option key={m} value={m}>{monthNameFromKey(m)}</option>)}</select></label>
    </div>
    {/* The day view follows the month pick above: the same attendance card
        re-reads its date when the month switches. */}
    <div className="mt-5">
      <DayStatusCard monthKey={monthKey} moduleKey={moduleKey} scope="admin" label="Attendance" icon={CalendarCheck2} testId="status-attendance" />
    </div>
    <div className="mt-4">
      <Card label="Assessment" done={assessmentDone} total={total} detail={projects.length ? projects.map((p) => `Project ${p.project}: ${p.marked} of ${total}`).join(' · ') : 'No projects for this month yet.'} icon={ClipboardCheck} testId="status-assessment" />
    </div>
  </section>;
}

// One day of one module, counted four ways. Shared by the module desk and the admin
// module page so the two desks can never read different numbers for the same day.
type DayStatus = {
  date: string;
  sunday: boolean;
  event: { date: string; title: string } | null;
  totalStudents: number;
  eligible: number;
  present: number;
  absent: number;
  leave: number;
  unmarked: number;
  assessmentMarked: number;
  assessmentPending: number;
};

function DayStatusCard({ monthKey, moduleKey, scope, label, icon: Icon, testId, wide = false }: { monthKey?: string; moduleKey: Module; scope: 'admin' | 'teacher'; label: string; icon: typeof Users; testId: string; wide?: boolean }) {
  const [date, setDate] = useState(todayIso);
  const [status, setStatus] = useState<DayStatus | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // When the surrounding page picks a different month, the day counter follows to the
  // start of it — the date chips stay authoritative until the month moves again.
  useEffect(() => {
    if (!monthKey) return;
    const today = todayIso();
    if (monthKey === today.slice(0, 7)) {
      setDate(today);
    } else {
      setDate(`${monthKey}-01`);
    }
  }, [monthKey]);

  useEffect(() => {
    let alive = true;
    setStatus(null);
    const url = scope === 'admin'
      ? `/api/admin/modules/${moduleKey}/day-status?date=${date}`
      : `/api/teacher/day-status?date=${date}`;
    fetch(url)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (alive && ok) setStatus(data as DayStatus); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [moduleKey, scope, date, reloadToken]);

  const tiles = status == null ? [] : [
    { key: 'present', label: 'Present', value: status.present, tone: 'text-emerald-600' },
    { key: 'absent', label: 'Absent', value: status.absent, tone: 'text-destructive' },
    { key: 'leave', label: 'On leave', value: status.leave, tone: 'text-amber-600' },
    { key: 'unmarked', label: 'Not marked', value: status.unmarked, tone: 'text-muted-foreground' },
  ];

  return <div className="rounded-xl border border-border bg-card p-5" data-testid={testId}>
    <div className={wide ? 'flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between' : ''}>
      <div className={wide ? 'lg:w-64 lg:shrink-0' : ''}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-primary"><Icon size={17} /></span>
            <span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          </span>
        </div>
        {/* The date carries the calendar icon and is itself the picker, so there is only one
            control on the card. */}
        <div className="mt-4">
          <DatePicker value={date} onChange={setDate} testId={`${testId}-date`}>
            <span className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition hover:bg-muted" data-testid={`${testId}-day`}>
              <CalendarCheck2 size={15} className="shrink-0 text-muted-foreground" />
              <span className="font-display text-sm font-bold leading-tight">{longDate(date)}</span>
            </span>
          </DatePicker>
        </div>

        {status == null ? <div className="mt-4 h-16 animate-pulse rounded bg-muted" />
          : status.event != null ? <div className="mt-4 rounded-lg border border-amber-400/70 bg-amber-50 p-4" data-testid={`${testId}-event`}>
            <p className="font-mono-ui text-[10px] uppercase tracking-wider text-amber-700">Event</p>
            <p className="mt-1 font-display text-xl font-bold text-amber-900">{status.event.title}</p>
            <p className="mt-1 text-xs text-amber-800">No attendance is counted on this day for any module, and it is left out of everyone&apos;s percentage.</p>
          </div>
          : status.sunday ? <div className="mt-4 rounded-lg bg-muted/50 p-4" data-testid={`${testId}-sunday`}>
            <p className="font-display text-xl font-bold text-muted-foreground">Sunday</p>
            <p className="mt-1 text-xs text-muted-foreground">Not a teaching day, so nothing was marked and nothing is counted.</p>
          </div>
          : <div className="mt-4">
            <p className="font-display text-4xl font-bold">{status.present}<span className="text-2xl text-muted-foreground"> / {status.eligible}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">present on this day out of {status.eligible} student{status.eligible === 1 ? '' : 's'} whose course is running</p>
          </div>}
      </div>

      {/* Wide: the four buckets sit beside the headline, vertically centred against it
          rather than hanging off the top. */}
      {status != null && status.event == null && !status.sunday && <div className={wide ? 'grid flex-1 grid-cols-2 gap-2 self-center sm:grid-cols-4 lg:max-w-2xl' : 'mt-4 grid grid-cols-4 gap-2'}>
        {tiles.map((tile) => <div key={tile.key} className="rounded-lg bg-muted/60 px-2 py-3 text-center" data-testid={`${testId}-${tile.key}`}>
          <p className={`font-display text-2xl font-bold ${tile.tone}`}>{tile.value}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
        </div>)}
      </div>}
    </div>
    {status != null && status.event == null && !status.sunday && <p className="mt-4 text-xs text-muted-foreground lg:mt-3">
      {status.totalStudents} on the roster{status.eligible < status.totalStudents ? `, ${status.totalStudents - status.eligible} not in a course on this day` : ''}. {status.unmarked > 0 ? `${status.unmarked} still to mark.` : 'Everyone has been marked.'}
    </p>}
  </div>;
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
  const moduleKey = (user.module ?? 'ai') as Module;
  return <>
    <PageHeader kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`} title="Keep Your Module Updated." detail="Where this module stands today, day by day. Fill the register from Mark Attendance in the side panel, or open the student list to upload project marks." action={<Link href="/teacher/students" className="flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/15 px-3 py-2 text-xs font-semibold text-primary hover:bg-accent/30" data-testid="link-open-student-list"><Users size={15} /> Open student list</Link>} />
    <div className="grid gap-4 lg:grid-cols-2" data-testid="module-desk-summary">
      {/* Just the number, but stretched to the same height as the card beside it — the two
          sit side by side and one being shorter read as a mistake. */}
      <div className="flex items-center gap-4 rounded-xl border border-accent/40 bg-accent/15 px-4 py-3.5" data-testid="card-total-students">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-primary"><Users size={15} /></span>
        <div>
          <p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">Total students</p>
          <p className="font-display text-2xl font-bold leading-tight">{total}</p>
        </div>
      </div>
      {/* Assessments stay across the whole course, as before. */}
      <ProgressCard label="Assessments" done={overview?.assessmentMarked ?? 0} pending={overview?.assessmentPending ?? 0} doneLabel="marks uploaded" pendingLabel="no marks yet" icon={ClipboardCheck} testId="card-assessments" />
    </div>
    {/* Attendance gets the full width underneath: it is the card that moves day by day, so
        it has room for the date and all four buckets side by side. */}
    <div className="mt-4" data-testid="module-desk-attendance">
      <DayStatusCard moduleKey={moduleKey} scope="teacher" label="Attendance" icon={CalendarCheck2} testId="card-attendance" wide />
    </div>
    <p className="mt-4 text-xs text-muted-foreground">Tap the calendar on the attendance card to read a back date. Week-by-week and project-by-project detail is in the <Link href="/teacher/students" className="font-semibold text-primary hover:underline">student list</Link>.</p>
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

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]}`;
}

type RegisterRow = Student & { week: number | null; eligible: boolean; present: boolean; leave: boolean; recorded: boolean; markedToday?: boolean };
type Mark = 'present' | 'absent' | 'leave';

// A month grid behind a calendar icon, so any past day can be picked without a native
// <input type="date"> — that one renders in the browser's own locale and puts the month
// first, which is not the order this app uses anywhere else.
//
// The trigger is whatever the caller passes as children, so the calendar icon that is
// already on screen becomes the control rather than a second button appearing beside it.
// Reused by the module desk, the admin module page and the register itself.
function DatePicker({ value, onChange, max, testId, children, align = 'right' }: { value: string; onChange: (iso: string) => void; max?: string; testId?: string; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => new Date(`${value}T00:00:00Z`));
  const limit = max ?? todayIso();

  useEffect(() => { if (open) setView(new Date(`${value}T00:00:00Z`)); }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-day-picker]')) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape); };
  }, [open]);

  const cells = monthGrid(view);
  const month = view.getUTCMonth();
  const move = (delta: number) => setView(new Date(Date.UTC(view.getUTCFullYear(), month + delta, 1)));

  return <div className="relative" data-day-picker>
    <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Pick a date" aria-expanded={open} title="Pick a date" data-testid={testId}>
      {children}
    </button>
    {open && <div className={`absolute z-30 mt-2 w-64 rounded-xl border border-border bg-card p-3 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`} role="dialog" aria-label="Pick a date" data-testid={testId ? `${testId}-popover` : undefined}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Previous month"><ChevronLeft size={16} /></button>
        <p className="font-display text-sm font-bold">{MONTH_LABELS[month]} {view.getUTCFullYear()}</p>
        <button type="button" onClick={() => move(1)} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Next month"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => <span key={index} className="py-1 font-mono-ui text-[9px] uppercase text-muted-foreground">{label}</span>)}
        {cells.map((cell, index) => {
          if (!cell) return <span key={index} />;
          const iso = cell.toISOString().slice(0, 10);
          const future = iso > limit;
          const chosen = iso === value;
          return <button
            key={index}
            type="button"
            disabled={future}
            onClick={() => { onChange(iso); setOpen(false); }}
            className={`rounded-md py-1.5 text-xs transition ${chosen ? 'bg-primary font-bold text-primary-foreground' : future ? 'text-muted-foreground/40' : 'text-foreground hover:bg-muted'}`}
            data-testid={`day-${iso}`}
          >{cell.getUTCDate()}</button>;
        })}
      </div>
      <button type="button" onClick={() => { onChange(limit); setOpen(false); }} className="mt-2 w-full rounded-md border border-border py-1.5 text-xs font-semibold text-primary transition hover:bg-muted" data-testid={testId ? `${testId}-today` : undefined}>Back to today</button>
    </div>}
  </div>;
}

// Three checkboxes per student: P ticks green, A ticks red, L ticks amber for leave
// (which still counts as attended). A row with none ticked stays grey and is left exactly
// as it was. Everything that has been recorded before can be ticked again to fix it —
// saved days are no longer locked.
function MarkCheckboxes({ row, mark, disabled, reason, onPick }: { row: RegisterRow; mark: Mark | undefined; disabled: boolean; reason: string; onPick: (next: Mark | undefined) => void }) {
  const box = (kind: Mark, letter: string, on: string, accent: string) => {
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
        className={`h-4 w-4 ${accent} ${disabled ? '' : 'cursor-pointer'}`}
        aria-label={`${row.fullName} ${kind}`}
        data-testid={`check-${kind}-${row.id}`}
      />
      {letter}
    </label>;
  };
  return <div className="flex flex-col items-end gap-1">
    <div className="flex items-center gap-1.5">
      {box('present', 'P', 'border-emerald-600 bg-emerald-500/15 text-emerald-700', 'accent-emerald-600')}
      {box('absent', 'A', 'border-destructive bg-destructive/10 text-destructive', 'accent-red-600')}
      {box('leave', 'L', 'border-amber-500 bg-amber-500/15 text-amber-700', 'accent-amber-500')}
    </div>
    {disabled && <span className="whitespace-nowrap text-[10px] text-muted-foreground" data-testid={`reason-${row.id}`}>{reason}</span>}
  </div>;
}

// One institute-wide non-teaching day. Written once by whichever desk noticed it first and
// shown to all three, because the institute closes as a whole.
type CalendarEvent = { date: string; title: string; type: string };

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
  // The institute-wide non-teaching days. An event on the date being shown replaces the
  // register: there is nothing to mark, and the day must not be counted against anybody.
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/teacher/events?from=${date}&to=${date}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        const found = ok ? (data as CalendarEvent[])[0] ?? null : null;
        setEvent(found);
        setEventTitle(found?.title ?? '');
      })
      .catch(() => { if (alive) setEvent(null); });
    return () => { alive = false; };
  }, [date, reloadToken]);

  const saveEvent = () => {
    if (!eventTitle.trim()) { setEventError('Say what the event was, e.g. PTM or Diwali holiday.'); return; }
    setEventBusy(true); setEventError('');
    fetch('/api/teacher/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, title: eventTitle }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, status: res.status, data })))
      .then(({ ok, status, data }) => {
        if (ok) { setEvent(data as CalendarEvent); setReloadToken((v) => v + 1); return; }
        // A 404 means the server has not been redeployed with this route yet, which is not
        // something the user can fix by retyping the title.
        setEventError(status === 404
          ? 'The server does not have the event feature yet — it needs to be redeployed. Nothing was saved.'
          : ((data as { error?: string }).error) ?? `Could not save that event (error ${status}).`);
      })
      .catch(() => setEventError('Could not reach the server to save that event.'))
      .finally(() => setEventBusy(false));
  };

  const clearEvent = () => {
    setEventBusy(true); setEventError('');
    fetch(`/api/teacher/events/${date}`, { method: 'DELETE' })
      .then((res) => { if (res.ok) { setEvent(null); setEventTitle(''); setReloadToken((v) => v + 1); } else setEventError('Could not remove that event.'); })
      .catch(() => setEventError('Could not remove that event.'))
      .finally(() => setEventBusy(false));
  };

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
        // Saved rows come back showing what was recorded; the rest start grey. Every
        // row stays tickable, so a saved day can be changed and saved again. Only the
        // rows where THIS day was actually saved get a chip — otherwise a student whose
        // week row merely exists from another day's entry would show 'absent'.
        setMarks(Object.fromEntries(list
          .filter((r) => r.eligible && r.recorded && r.markedToday)
          .map((r) => [r.id, r.leave ? 'leave' : r.present ? 'present' : 'absent'] as const)));
      })
      .catch(() => { if (alive) { setError('Could not open the register for this date.'); setRows([]); } });
    return () => { alive = false; };
  }, [date, reloadToken]);

  useEffect(() => { setError(''); setNotice(''); }, [date]);

  const sunday = dayIndex(new Date(`${date}T00:00:00Z`)) > 5;
  const all = rows ?? [];
  const eligible = all.filter((row) => row.eligible);
  const query = search.trim().toLowerCase();
  const shown = all.filter((row) => studentMatches(row, query));
  const presentIds = eligible.filter((row) => marks[row.id] === 'present').map((row) => row.id);
  const absentIds = eligible.filter((row) => marks[row.id] === 'absent').map((row) => row.id);
  const leaveIds = eligible.filter((row) => marks[row.id] === 'leave').map((row) => row.id);
  const touchedIds = presentIds.length + absentIds.length + leaveIds.length;
  const untouched = eligible.length - touchedIds;

  const markable = sunday ? 0 : eligible.length;
  const setAll = (mark: Mark | undefined) => setMarks((v) => {
    if (mark) return { ...v, ...Object.fromEntries(eligible.map((row) => [row.id, mark])) };
    const cleared = new Set(eligible.map((row) => row.id));
    return Object.fromEntries(Object.entries(v).filter(([id]) => !cleared.has(id)));
  });

  const save = () => {
    if (touchedIds === 0) { setError('Mark at least one student P, A or L before saving.'); return; }
    setSaving(true); setError(''); setNotice('');
    fetch('/api/teacher/attendance/day', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, present: presentIds, absent: absentIds, leave: leaveIds }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error('save failed');
        const body = data as { saved: number; skipped?: number };
        setNotice(`Saved for ${longDate(date)} — ${presentIds.length} present, ${absentIds.length} absent, ${leaveIds.length} on leave${untouched ? `, ${untouched} left blank` : ''}. You can still go back and change any row.`);
        setReloadToken((v) => v + 1);
      })
      .catch(() => setError('Could not save the register. Try again.'))
      .finally(() => setSaving(false));
  };

  return <>
    <PageHeader
      kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`}
      title="Mark Attendance"
      detail="Today's register, ready to fill. Tick P for present, A for absent or L for leave; anything left grey is not recorded either way. You can go back to any earlier day and change a row — attendance stays editable once saved."
      action={<Button type="button" onClick={save} disabled={saving || rows == null || sunday || event != null || markable === 0} data-testid="button-save-register">{saving ? 'Saving…' : <><Check size={15} /> Save attendance</>}</Button>}
    />

    <section className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {/* The icon that was already on this date panel is the picker. Clicking it opens the
            month grid — no second button sitting beside it. */}
        <DatePicker value={date} onChange={(iso) => setOverride(iso === today ? null : iso)} testId="register-date-picker" align="left">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-primary transition hover:opacity-80" data-testid="register-date-icon"><CalendarCheck2 size={19} /></span>
        </DatePicker>
        <div>
          <p className="font-display text-lg font-bold leading-tight" data-testid="text-register-date">{longDate(date)}</p>
          <p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{override ? 'Earlier date · tap the calendar to change' : 'Today · updates on its own'}</p>
        </div>
        {/* The event sits beside the date, so anyone opening the register for that day reads
            what it was without having to open the event box. */}
        {event && <span className="ml-2 rounded-full border border-amber-400/70 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800" data-testid="text-register-event-chip">{event.title}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setOverride(shiftIso(date, -1))} className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => setOverride(shiftIso(date, 1))} disabled={date >= today} className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="Next day" data-testid="button-next-day"><ChevronRight size={16} /></button>
        {override && <Button type="button" size="sm" variant="outline" onClick={() => setOverride(null)} data-testid="button-back-to-today">Back to today</Button>}
      </div>
    </section>

    {sunday && <p className="mb-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="status-sunday">Sunday is not a teaching day, so nothing can be recorded against it. The date still moves on to tomorrow by itself.</p>}

    {/* An event replaces the register for the day. Saying it here is the whole point: the
        day then counts for nobody in any module, instead of showing up as an absence. */}
    <section className={`mb-5 rounded-xl border p-4 ${event ? 'border-amber-400/60 bg-amber-50/60' : 'border-dashed border-border bg-card'}`} data-testid="panel-event">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event on this day</p>
          {event
            ? <p className="mt-1 font-display text-lg font-bold text-amber-800" data-testid="text-event-title">{event.title}</p>
            : <p className="mt-1 text-sm text-muted-foreground">PTM, a holiday or an exam? Record it once here. All three modules get the day off and it is left out of every student&apos;s attendance percentage.</p>}
        </div>
        {event && <Button type="button" size="sm" variant="outline" onClick={clearEvent} disabled={eventBusy} data-testid="button-clear-event">Remove event</Button>}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="sm:max-w-sm"
          placeholder={event ? 'Change what it says' : 'e.g. PTM, Diwali holiday, exam'}
          value={eventTitle}
          onChange={(e) => setEventTitle(e.target.value)}
          disabled={sunday || eventBusy}
          data-testid="input-event-title"
          aria-label="Event title"
        />
        <Button type="button" onClick={saveEvent} disabled={sunday || eventBusy || eventTitle.trim() === ''} data-testid="button-save-event">
          {eventBusy ? 'Saving…' : event ? 'Update event' : 'Mark this day as an event'}
        </Button>
      </div>
      {sunday && <p className="mt-2 text-xs text-muted-foreground">It is a Sunday, so there is nothing to mark off anyway.</p>}
      {eventError && <p className="mt-2 text-xs text-destructive" data-testid="status-event-error">{eventError}</p>}
    </section>

    {event != null && rows != null && <p className="mb-5 rounded-xl border border-amber-400/60 bg-amber-50/60 px-4 py-3 text-sm text-amber-900" data-testid="status-event-day">{longDate(date)} is marked as <strong>{event.title}</strong>. No attendance is being taken and the day is excluded from everyone&apos;s percentage. Remove the event above if that is wrong.</p>}

    {!sunday && event == null && rows != null && all.length > 0 && eligible.length === 0 && <p className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="status-none-eligible">
      Nobody can be marked on {longDate(date)} — every student&apos;s joining date is later than this, so their course has not started yet. Each row below shows the date it opens from.
    </p>}

    {!sunday && event == null && rows != null && eligible.length > 0 && <p className="mb-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="status-all-locked">This register has been filled in before. Everything you see came back from the saved records — tick a different box and save to change it.</p>}

    {/* The search box and the table are hidden while an event stands, so there is nothing to
        fill in and no Save button to press. */}
    {event == null && <>
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
        <p className="text-xs text-muted-foreground" data-testid="text-register-tally"><strong className="text-emerald-600">{presentIds.length} present</strong> · <strong className="text-destructive">{absentIds.length} absent</strong> · <strong className="text-amber-600">{leaveIds.length} on leave</strong> · {untouched} not marked</p>
      </div>
      {rows == null ? <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
        : shown.length === 0 ? <EmptyState title="No matching students" detail={all.length === 0 ? 'Nobody is enrolled yet.' : 'Try a name, student ID, contact number or email.'} icon={UserRound} />
        : <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm" data-testid="table-register">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-2 font-semibold">#</th>
                <th className="py-2 pr-2 font-semibold">Student ID</th>
                <th className="py-2 pr-2 font-semibold">Name</th>
                <th className="py-2 pr-2 font-semibold">Father&apos;s name</th>
                <th className="py-2 text-right font-semibold">
                  <span className="mr-2 align-middle">Attendance</span>
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => setAll('present')} disabled={sunday || markable === 0} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition hover:border-emerald-600 hover:text-emerald-700 disabled:opacity-40" data-testid="button-all-present">All P</button>
                    <button type="button" onClick={() => setAll('absent')} disabled={sunday || markable === 0} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition hover:border-destructive hover:text-destructive disabled:opacity-40" data-testid="button-all-absent">All A</button>
                    <button type="button" onClick={() => setAll('leave')} disabled={sunday || markable === 0} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition hover:border-amber-500 hover:text-amber-700 disabled:opacity-40" data-testid="button-all-leave">All L</button>
                    <button type="button" onClick={() => setAll(undefined)} disabled={sunday || markable === 0} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition hover:border-foreground/40 hover:text-foreground disabled:opacity-40" data-testid="button-clear-marks">Clear</button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => {
                const reason = sunday ? 'Sunday — off day' : !row.eligible ? `Joins ${joinedOn(row.dateOfJoining)}` : '';
                return <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40" data-testid={`row-register-${row.id}`}>
                  <td className="py-2.5 pr-2 text-muted-foreground">{index + 1}</td>
                  <td className="py-2.5 pr-2 font-mono-ui text-xs font-semibold text-muted-foreground">{row.id}</td>
                  <td className="py-2.5 pr-2 font-medium">{row.fullName}</td>
                  <td className="py-2.5 pr-2 text-muted-foreground">{row.fathersName}</td>
                  <td className="py-2.5 text-right">
                    <MarkCheckboxes row={row} mark={marks[row.id]} disabled={sunday || !row.eligible} reason={reason} onPick={(next) => setMarks((v) => {
                      if (!next) { const { [row.id]: _drop, ...rest } = v; return rest; }
                      return { ...v, [row.id]: next };
                    })} />
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-register-error">{error}</p>}
      {notice && <p className="mt-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-register-success">{notice}</p>}
    </section>
    </>}
  </>;
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
type ReportMonth = { month: number; start: string | null; end: string | null; present: number; absent: number; total: number; percentage: number; recorded: boolean; events?: { date: string; title: string }[]; modules: ReportModule[] };
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

// Which course month a student is sitting in right now. The API sends each month's real
// first and last day, and those days are already admission-anchored, so the month holding
// today is the answer — no date maths here. Before the course starts or after it ends
// there is no such month, so fall back to the first month that has records.
function courseMonthFor(report: StudentReport, today: string): number {
  const live = report.months.find((m) => m.start && m.end && m.start <= today && today <= m.end);
  return live?.month ?? report.months.find((m) => m.recorded)?.month ?? 1;
}

// The same question asked without a loaded report, which is what the marks form has —
// only a joining date. The course is six calendar months starting with the joining month,
// so today sits in month N where N is how many calendar-month boundaries have passed.
// One rule has to match the API exactly: Sunday is never a teaching day, so someone who
// enrols on the last Sunday of a month starts their course on the 1st of the next month
// instead of having an empty month 1. Mirror that here or the two disagree by a month.
function monthForJoining(dateOfJoining: string, today: string): number {
  const joined = new Date(`${dateOfJoining}T00:00:00Z`);
  const now = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(joined.getTime()) || Number.isNaN(now.getTime())) return 1;
  let anchor = joined;
  while (anchor.getUTCDay() === 0) {
    anchor = new Date(anchor.getTime() + 86_400_000);
    if (anchor.getUTCMonth() !== joined.getUTCMonth() || anchor.getUTCFullYear() !== joined.getUTCFullYear()) break;
  }
  const month = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + (now.getUTCMonth() - anchor.getUTCMonth()) + 1;
  return Math.min(6, Math.max(1, month));
}

// The API sends each month's real first and last day; month 1 starts on the
// admission date rather than the 1st, and every later month runs a whole calendar month.
function monthRange(entry: ReportMonth): string {
  if (!entry.start || !entry.end) return '';
  const label = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]?.slice(0, 3)}`;
  };
  return `${label(entry.start)} – ${label(entry.end)}`;
}

// Months are named by their calendar month in the report. Each student's slices already
// line up with real calendar months — that is item 12's rule — so "Month N" can simply be
// the name of the month that slice covers. The slices themselves do not change, only
// how they are labelled.
function calendarMonthName(start: string | null, fallback: string): string {
  if (!start) return fallback;
  const d = new Date(`${start}T00:00:00Z`);
  return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function monthNameFromKey(monthKey: string): string {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// moduleFilter narrows the whole report to one module, so a module owner sees their
// own attendance and their own project marks instead of all three modules at once.
function MonthlyProgress({ report, compact = false, moduleFilter }: { report: StudentReport; compact?: boolean; moduleFilter?: Module | null }) {
  // The month shown is the one the student is actually in: the course month that holds
  // today, read off the real start/end dates the API sends. Opening the page mid course
  // therefore lands on the live month rather than month 1; a course that has not started
  // or has already finished falls back to the first month with records.
  const [month, setMonth] = useState(() => courseMonthFor(report, todayIso()));
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
  const eventCount = selected.events?.length ?? 0;

  return <>
    <section className={`rounded-xl border border-border bg-card ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-primary">Attendance{scopeLabel ? ` · ${scopeLabel}` : ''}</p>
          <h2 className={`mt-1 font-display font-bold ${compact ? 'text-xl' : 'text-2xl'}`}>Monthly report</h2>
          {range && <p className="mt-1 text-xs text-muted-foreground">{calendarMonthName(selected.start, `Month ${selected.month}`)} · {range}{report.joinedOn ? ` · admitted ${report.joinedOn}` : ''}</p>}
        </div>
        <label className="grid gap-1.5 text-sm font-medium">Month
          <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-report-month">
            {report.months.map((m) => <option key={m.month} value={m.month}>{calendarMonthName(m.start, `Month ${m.month}`)}{m.recorded ? '' : ' — no records'}</option>)}
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
      <p className="mt-3 text-xs text-muted-foreground">{calendarMonthName(selected.start, `Month ${selected.month}`)} has <strong className="text-foreground">{selected.total}</strong> teaching days{range ? ` (${range})` : ''}. Sundays are off{eventCount > 0 ? `, and ${eventCount} event day${eventCount === 1 ? '' : 's'} excluded` : ''}. The course is six calendar months starting with the month of enrolment, so the first covers only the rest of that month{range ? ` (${report.joinedOn} onwards)` : ''}.</p>
      {/* Name each event day, so a shorter denominator is never a mystery. */}
      {eventCount > 0 && <ul className="mt-2 flex flex-wrap gap-2" data-testid="list-month-events">
        {selected.events?.map((ev) => <li key={ev.date} className="rounded-full border border-amber-400/70 bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">{shortDate(ev.date)} · {ev.title}</li>)}
      </ul>}
    </section>

    <section className={`mt-6 rounded-xl border border-border bg-card ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-primary">Assessments{scopeLabel ? ` · ${scopeLabel}` : ''}</p>
          <h2 className={`mt-1 font-display font-bold ${compact ? 'text-xl' : 'text-2xl'}`}>Project marks — {calendarMonthName(selected.start, `Month ${selected.month}`)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{scopeLabel ? `${scopeLabel} runs two projects a month.` : 'Each module runs two projects a month.'}{range ? ` ${calendarMonthName(selected.start, `Month ${selected.month}`)} is ${range}.` : ''}</p>
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
  image: string | null;
};

// One image per notice — upload or paste on the compose form. Rendered inside the
// notice when it is opened. Sized small on purpose: it rides in the same JSON
// response as the rest of the announcements list.
function readImageAsDataUrl(file: File, onDone: (dataUrl: string) => void, onError: (message: string) => void) {
  if (file.size > 2_500_000) { onError('That image is over 2.5 MB — keep it a smaller one, like a phone poster.'); return; }
  const reader = new FileReader();
  reader.onerror = () => onError('We could not read that file. Try another image file.');
  reader.onload = () => onDone(reader.result as string);
  reader.readAsDataURL(file);
}

function announcementImageFile(event: React.DragEvent<HTMLElement> | React.ClipboardEvent<HTMLElement> | React.ChangeEvent<HTMLInputElement>): File | null {
  if ('clipboardData' in event) {
    for (const item of event.clipboardData?.items ?? []) {
      if (item.type.startsWith('image/')) return item.getAsFile();
    }
    return null;
  }
  if ('dataTransfer' in event) {
    for (const file of event.dataTransfer.files ?? []) {
      if (file.type.startsWith('image/')) return file;
    }
    return null;
  }
  const files = event.target.files;
  return files && files[0] && files[0].type.startsWith('image/') ? files[0] : files?.[0] ?? null;
}

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
  onSave?: (next: { title: string; body: string; image: string | null }) => void;
  onCancel?: () => void;
}) {
  const [openDialog, setOpenDialog] = useState(false);
  const [title, setTitle] = useState(notice.title);
  const [body, setBody] = useState(notice.body);
  const [image, setImage] = useState<string | null>(notice.image ?? null);

  // Reopening the editor must start from what is stored, not from a half-typed
  // draft the staff member abandoned last time.
  useEffect(() => {
    if (editing) { setTitle(notice.title); setBody(notice.body); setImage(notice.image ?? null); }
  }, [editing, notice.title, notice.body, notice.image]);

  const expanded = !!editing;

  // The whole card (and its arrow) opens the notice in a centered dialog on the same
  // screen. Clicks on a real button of their own (publish/edit/delete, upload) still
  // do their own job.
  const toggleFromArticle = (e: React.MouseEvent<HTMLElement>) => {
    if (editing) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, label')) return;
    setOpenDialog((v) => !v);
  };

  const pickImage = (file: File | null) => {
    if (!file) return;
    readImageAsDataUrl(file, (dataUrl) => setImage(dataUrl), () => {});
  };

  return <article className={`rounded-xl border border-border bg-card ${!editing ? 'cursor-pointer' : ''}`} onClick={toggleFromArticle} data-testid={`notice-${notice.id}`}>
    <div className="flex items-start gap-2 p-4">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpenDialog((v) => !v); }} aria-expanded={expanded || openDialog} disabled={editing} className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default" data-testid={`button-toggle-notice-${notice.id}`}>
        <ChevronDown size={18} className={`mt-0.5 shrink-0 text-primary transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <span className="min-w-0">
          <span className="block font-display text-lg font-bold leading-snug">{notice.title || 'Untitled notice'}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {notice.published ? `Published ${noticeDate(notice.publishedAt)}` : `Draft · written ${noticeDate(notice.createdAt)}`}
            {notice.authorName ? ` · ${notice.authorName}` : ''}
            {notice.image ? ' · Image attached' : ''}
          </span>
        </span>
      </button>
      {children}
    </div>

    {editing
      ? <div className="border-t border-border p-4" data-testid={`notice-edit-${notice.id}`}>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid={`input-edit-title-${notice.id}`} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Message<Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} onPaste={(e) => {
              const file = announcementImageFile(e);
              if (file) { e.preventDefault(); setImage(null); readImageAsDataUrl(file, setImage, () => {}); }
            }} data-testid={`input-edit-body-${notice.id}`} /></label>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Image (optional)</span>
              {image && <img src={image} alt="Notice attachment" className="max-h-48 rounded-lg border border-border object-contain" data-testid={`preview-edit-image-${notice.id}`} />}
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted" data-testid={`button-upload-image-edit-${notice.id}`}>
                  <ImageIcon size={14} /> {image ? 'Replace image' : 'Upload image'}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />
                </label>
                {image && <button type="button" onClick={() => setImage(null)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-destructive" data-testid={`button-clear-image-edit-${notice.id}`}>Remove image</button>}
                <span className="text-[11px] text-muted-foreground">Paste a picture into the message box to attach it.</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy} data-testid={`button-cancel-edit-${notice.id}`}>Cancel</Button>
            <Button type="button" size="sm" onClick={() => onSave?.({ title, body, image })} disabled={busy} data-testid={`button-save-edit-${notice.id}`}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      : null}
    {openDialog && !editing && (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-primary/40 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" data-testid={`notice-dialog-${notice.id}`} onClick={() => setOpenDialog(false)}>
        <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-display text-2xl font-bold leading-snug" data-testid={`notice-dialog-title-${notice.id}`}>{notice.title || 'Notice'}</h3>
            <button type="button" onClick={() => setOpenDialog(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close" data-testid={`button-close-notice-x-${notice.id}`}><X size={17} /></button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {notice.published ? `Published ${noticeDate(notice.publishedAt)}` : `Draft · written ${noticeDate(notice.createdAt)}`}
            {notice.authorName ? ` · ${notice.authorName}` : ''}
          </p>
          {notice.body && <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground" data-testid={`notice-dialog-body-${notice.id}`}>{notice.body}</p>}
          {notice.image && <img src={notice.image} alt="Announcement" className="mt-4 max-h-80 rounded-lg border border-border object-contain" data-testid={`notice-dialog-image-${notice.id}`} />}
          <div className="mt-6 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpenDialog(false)} data-testid={`button-close-notice-${notice.id}`}>Close</Button>
          </div>
        </div>
      </div>
    )}
  </article>;
}

// One section per module. The student portal and the admin desk pass all three; a
// module desk passes only its own, so an AI teacher never sees an empty "Social
// Media" heading for notices that are not theirs to write.
function NoticesByModule({ notices, emptyDetail, modules: visibleProp, actions, renderRow }: {
  notices: Announcement[];
  emptyDetail: string;
  modules?: typeof adminModules;
  actions?: (notice: Announcement) => ReactNode;
  renderRow?: (notice: Announcement) => ReactNode;
}) {
  const catalog = useCatalogModules();
  const visible = visibleProp ?? catalog;
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

// One screen, three desks. A module owner writes for their own module; the admin sits
// above all three, picks the module on the way in, and can moderate anything a
// teacher wrote; a branch office writes into any of its own modules. `scope` swaps
// the API prefix and turns the module picker on.
function AnnouncementsPage({ user, scope }: { user: CurrentUser; scope: 'admin' | 'teacher' | 'branch' }) {
  const isAdmin = scope === 'admin';
  const isBranch = scope === 'branch';
  const base = `/api/${scope}/announcements`;
  const [notices, setNotices] = useState<Announcement[] | null>(null);
  const [module, setModule] = useState<Module>(user.module ?? 'ai');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
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
    if (!title.trim() && !body.trim() && !image) { setError('Enter a title, a message, or attach an image.'); return; }
    setBusy(true); setError(''); setNotice('');
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isAdmin || isBranch ? { title, body, publish, module, image } : { title, body, publish, image }),
    })
      .then((res) => { if (!res.ok) throw new Error('save failed'); })
      .then(() => {
        setNotice(publish ? 'Published — students can read it now.' : 'Saved as a draft. Students cannot see it yet.');
        setTitle(''); setBody(''); setImage(null); refresh();
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

  const saveEdit = (id: number, next: { title: string; body: string; image: string | null }) => {
    if (!next.title.trim() && !next.body.trim() && !next.image) { setError('Enter a title, a message, or attach an image.'); return; }
    setBusy(true); setError(''); setNotice('');
    fetch(`${base}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next.title, body: next.body, image: next.image }),
    })
      .then((res) => { if (!res.ok) throw new Error('update failed'); setNotice('Notice updated.'); setEditingId(null); refresh(); })
      .catch(() => setError('We could not save that change. Try again.'))
      .finally(() => setBusy(false));
  };

  const published = (notices ?? []).filter((n) => n.published);
  const drafts = (notices ?? []).filter((n) => !n.published);
  // The teacher API already scopes to their module; this stops the UI drawing empty
  // headings for the two modules they can neither read nor write.
  const catalog = useCatalogModules();
  const branches = useBranches();
  const branchList = branches ?? [];
  const [branch, setBranch] = useState<string>('');
  const currentBranch = isBranch ? (branchList.find((b) => b.name === user.displayName) ?? null) : null;
  const selectedBranch = currentBranch ?? (branchList.find((b) => String(b.id) === branch) ?? null);
  const branchModules = catalog.filter((m) => {
    const source = currentBranch ?? selectedBranch;
    return source ? source.modules.some((mod) => mod.id === m.key) : false;
  });
  const pickableModules = isAdmin || isBranch ? branchModules : catalog;
  const visibleModules = isAdmin || isBranch
    ? branchModules
    : catalog.filter((m) => m.key === (user.module ?? 'ai'));

  // A branch module picker needs a concrete default once the catalog loads: unlike a
  // teacher, the branch's desk does not own exactly one module.
  useEffect(() => {
    if (isBranch && branchModules.length > 0 && !branchModules.some((m) => m.key === module)) {
      setModule(branchModules[0].key as Module);
    }
  }, [isBranch, branchModules, module]);

  return <>
    <PageHeader
      kicker={isAdmin ? 'Admin / announcements' : isBranch ? `Branch / ${user.displayName}` : `Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`}
      title="Announcements"
      detail={isAdmin
        ? 'Every notice across all three modules. Write one for any module, or take down something a module owner posted.'
        : isBranch
          ? `Notices for ${user.displayName} and its modules only. Publish one and it appears on the branch's students' portal straight away.`
          : `Notices for ${user.module ? moduleNames[user.module] : 'your module'} only. Publish one and it appears on your students' portal straight away.`} />

    <section className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-semibold text-primary">New notice</p>
      <h2 className="mt-1 font-display text-2xl font-bold">Write an announcement</h2>
      <div className="mt-5 grid gap-3">
        {isAdmin && branchList.length > 0 && <label className="grid gap-1.5 text-sm font-medium">Branch<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={branch} onChange={(e) => { const next = e.target.value; setBranch(next); const sel = branchList.find((b) => String(b.id) === next); if (sel?.modules[0]) setModule(sel.modules[0].id as Module); }} data-testid="select-notice-branch"><option value="">— Select branch —</option>{branchList.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}</select></label>}
        {(isAdmin ? selectedBranch != null : isBranch ? branchModules.length > 0 : false) && <label className="grid gap-1.5 text-sm font-medium">Module<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={module} onChange={(e) => setModule(e.target.value as Module)} data-testid="select-notice-module">{pickableModules.length === 0 && <option value="">— no modules —</option>}{pickableModules.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select></label>}
        <label className="grid gap-1.5 text-sm font-medium">Title<Input placeholder="e.g. Class timings changed for next week" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="input-notice-title" /></label>
        <label className="grid gap-1.5 text-sm font-medium">Message<Textarea rows={5} placeholder={isAdmin ? 'Write what the students need to know' : 'Write what your students need to know'} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} onPaste={(e) => {
          const file = announcementImageFile(e);
          if (file) { e.preventDefault(); setImage(null); readImageAsDataUrl(file, setImage, setError); }
        }} data-testid="input-notice-body" /></label>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Image (optional)</span>
          {image && <img src={image} alt="Notice attachment" className="max-h-48 rounded-lg border border-border object-contain" data-testid="preview-notice-image" />}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted" data-testid="button-upload-image-notice">
              <ImageIcon size={14} /> {image ? 'Replace image' : 'Upload image'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file) readImageAsDataUrl(file, setImage, setError);
              }} />
            </label>
            {image && <button type="button" onClick={() => setImage(null)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-destructive" data-testid="button-clear-image-notice">Remove image</button>}
            <span className="text-[11px] text-muted-foreground">Or paste a picture into the message box to attach it.</span>
          </div>
        </div>
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

  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (failed) return <><PageHeader kicker="Student / my profile" title="My profile" detail="We could not open your details." /><ErrorState retry={load} /></>;
  if (!profile) return <LoadingScreen label="Opening your profile" />;

  const uploadPhoto = (file: File | undefined) => {
    if (!file) return;
    setPhotoError(''); setPhotoBusy(true);
    readSquarePhoto(file)
      .then((photo) => fetch('/api/student/photo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo }) }))
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (!ok) throw new Error('upload failed'); setProfile((v) => (v ? { ...v, photo: (data as { photo: string | null }).photo } : v)); })
      .catch(() => setPhotoError('We could not upload that image. Try a PNG or JPEG under 1.5 MB.'))
      .finally(() => { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ''; });
  };

  const rows: Array<[string, string]> = [
    ['Name', profile.fullName],
    ["Father's name", profile.fathersName],
    ['Course', profile.course],
    ['Address', profile.address || '—'],
    ['Contact no.', profile.contactNumber],
    ['Email', profile.email],
  ];

  return <>
    <PageHeader kicker="Student / my profile" title="My profile" detail="The details your institute holds for you. Your photo is the one detail you can change yourself — tap the camera on it. For anything else, ask your institute." action={<div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"><Avatar photo={profile.photo} name={profile.fullName} size={32} testId="header-profile-photo" /><span className="text-xs font-semibold">{user.studentId ?? 'Student'}</span></div>} />
    <section className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-semibold text-primary">Your record</p>
      <h2 className="mt-1 font-display text-2xl font-bold">Basic details</h2>
      <div className="mt-5 flex items-center gap-4 border-b border-border/70 pb-5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={photoBusy}
          className="group relative shrink-0 cursor-pointer rounded-full disabled:cursor-wait"
          title={profile.photo ? 'Change your photo' : 'Add your photo'}
          data-testid="button-change-my-photo"
        >
          <Avatar photo={profile.photo} name={profile.fullName} size={88} testId="profile-photo" placeholderTestId="profile-photo-placeholder" />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-8 w-8 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-sm transition group-hover:scale-105" data-testid="span-photo-camera">
            <Camera size={15} />
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} data-testid="input-my-photo" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold">{profile.fullName}</p>
          <p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{user.studentId ?? 'Student'}</p>
          <p className="mt-1 text-xs text-muted-foreground">{photoBusy ? 'Uploading your photo…' : profile.photo ? 'Tap the camera to change your photo.' : 'Tap the camera to add your photo.'}</p>
          {photoError && <p className="mt-1 text-xs text-destructive" data-testid="status-my-photo-error">{photoError}</p>}
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
  const catalog = useCatalogModules();
  const find = (module: Module, kind: DocumentKind) => docs?.find((d) => d.module === module && d.kind === kind);
  return <>
    <PageHeader kicker="Student / project" title="Project" detail="The project plan and the guidelines for each module. Open one to read it in full." />
    {failed ? <ErrorState />
      : docs == null ? <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-muted" />)}</div>
      : <div className="grid gap-4">{catalog.map((meta) => (
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
  const catalog = useCatalogModules();
  const find = (module: Module) => docs?.find((d) => d.module === module && d.kind === 'syllabus');
  return <>
    <PageHeader kicker="Student / module information" title="Module information" detail="What each of your three modules covers. Open a syllabus to read it in full." />
    {failed ? <ErrorState />
      : docs == null ? <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>
      : <div className="grid gap-4">{catalog.map((meta) => (
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
  scope: 'admin' | 'teacher' | 'branch';
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
      const body = scope === 'admin' || scope === 'branch'
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
    const url = scope === 'teacher' ? `/api/teacher/documents/${kind}` : `/api/${scope}/documents/${module}/${kind}`;
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

// Admin manages all three modules; a module desk only ever sees its own; a branch
// office sees the files of its own modules.
function CourseDocumentsPage({ user, scope }: { user: CurrentUser; scope: 'admin' | 'teacher' | 'branch' }) {
  const { docs, failed, refresh } = useCourseDocuments(scope);
  const catalog = useCatalogModules();
  const isAdmin = scope === 'admin';
  const isBranch = scope === 'branch';
  const branches = useBranches();
  const branchList = branches ?? [];
  const [branch, setBranch] = useState<string>('');
  const currentBranch = isBranch ? (branchList.find((b) => b.name === user.displayName) ?? null) : null;
  const selectedBranch = currentBranch ?? (branchList.find((b) => String(b.id) === branch) ?? null);
  const branchModules = catalog.filter((m) => {
    const source = currentBranch ?? selectedBranch;
    return source ? source.modules.some((mod) => mod.id === m.key) : false;
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const visible = scope === 'branch'
    ? branchModules.map((m, i) => ({ ...m, number: i + 1 }))
    : scope === 'admin' ? branchModules
    : catalog.filter((m) => m.key === (user.module ?? 'ai'));
  const find = (module: Module, kind: DocumentKind) => docs?.find((d) => d.module === module && d.kind === kind);

  return <>
    <PageHeader
      kicker={scope === 'admin' ? 'Admin / course files' : scope === 'branch' ? `Branch / ${user.displayName}` : `Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`}
      title="Course files"
      detail={scope === 'admin'
        ? 'The syllabus and project PDFs students read. Uploading a file replaces the one already there, so the old version disappears from the student portal at the same moment.'
        : 'The syllabus and project PDFs your students read. Uploading a file replaces the one already there — the old version comes down straight away.'} />

    {isAdmin && branchList.length > 0 && <label className="mb-4 grid w-72 gap-1.5 text-sm font-medium">Branch<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="select-documents-branch"><option value="">— Select branch —</option>{branchList.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}</select></label>}

    {error && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-documents-error">{error}</p>}
    {notice && <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-documents-success">{notice}</p>}

    {failed ? <ErrorState retry={refresh} />
      : docs == null ? <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-60 animate-pulse rounded-xl bg-muted" />)}</div>
      : isAdmin && !selectedBranch ? <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Choose a branch above to see its course files.</p>
      : visible.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No modules available for this branch yet.</p>
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

type NewStudentInput = { fullName: string; fathersName: string; course: string; dateOfJoining: string; contactNumber: string; email: string; password: string; address: string | null; guardianContact: string | null; branchId?: number | null };

type StudentProfileForm = { fullName: string; fathersName: string; course: string; dateOfJoining: string; contactNumber: string; guardianContact: string; email: string; address: string };

function JoiningDateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  return <label className="grid gap-1.5 text-sm font-medium">Joining date
    <input type="date" className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)} data-testid="input-student-doj" aria-label="Joining date" />
  </label>;
}

function StudentEnrolForm({ kicker, total, creating, photoBase, onCreate, showBranch = true }: { kicker: string; total: number; creating: boolean; photoBase: string; onCreate: (data: NewStudentInput) => Promise<Student>; showBranch?: boolean }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const branches = useBranches();
  const emptyForm = { fullName: '', fathersName: '', course: 'Digital Marketing with AI', dateOfJoining: '', contactNumber: '', guardianContact: '', address: '', email: '', password: '', confirmPassword: '' };
  const [form, setForm] = useState(emptyForm);
  const [branchId, setBranchId] = useState<string>('');
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
    onCreate({ fullName: form.fullName.trim(), fathersName: form.fathersName.trim(), course: form.course, dateOfJoining: form.dateOfJoining, contactNumber: form.contactNumber.trim(), email, password, address: form.address.trim() || null, guardianContact: form.guardianContact.trim() || null, branchId: branchId ? Number(branchId) : null })
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
      <form onSubmit={handleEnroll} className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><div className="xl:col-span-1"><Field label="Full name" value={form.fullName} onChange={updateForm('fullName')} minLength={2} required data-testid="input-student-full-name" /></div><div className="xl:col-span-1"><Field label="Father&apos;s name" value={form.fathersName} onChange={updateForm('fathersName')} minLength={2} required data-testid="input-student-fathers-name" /></div><label className="grid gap-1.5 text-sm font-medium">Course<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={form.course} onChange={updateForm('course')} data-testid="select-student-course"><option>Digital Marketing with AI</option></select></label>{showBranch && branches && branches.length > 0 && <label className="grid gap-1.5 text-sm font-medium">Branch<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)} data-testid="select-student-branch"><option value="">— select branch —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}<JoiningDateField value={form.dateOfJoining} onChange={(iso) => setForm((v) => ({ ...v, dateOfJoining: iso }))} /><Field label="Contact number" value={form.contactNumber} onChange={updateForm('contactNumber')} minLength={6} maxLength={12} required data-testid="input-student-contact" /><Field label="Parent / guardian contact" value={form.guardianContact} onChange={updateForm('guardianContact')} maxLength={12} placeholder="Optional" data-testid="input-student-guardian-contact" /><Field label="Email address" type="email" value={form.email} onChange={updateForm('email')} required data-testid="input-student-email" /><div className="sm:col-span-2 xl:col-span-3"><label className="grid gap-1.5 text-sm font-medium">Address<Textarea rows={2} placeholder="Optional — house, street, city, pin code" value={form.address} onChange={(ev) => setForm((v) => ({ ...v, address: ev.target.value }))} data-testid="input-student-address" /></label></div><PasswordField label="Password" value={form.password} onChange={updateForm('password')} minLength={6} required data-testid="input-student-password" toggleTestId="button-toggle-enrol-pwd" /><PasswordField label="Confirm password" value={form.confirmPassword} onChange={updateForm('confirmPassword')} minLength={6} required data-testid="input-student-confirm-password" toggleTestId="button-toggle-enrol-confirm-pwd" /><div className="flex items-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { const next = randomPassword(); setForm((v) => ({ ...v, password: next, confirmPassword: next })); }} className="h-9" data-testid="button-generate-password"><KeyRound size={14} /> Generate</Button></div><div className="flex items-end sm:col-span-2 xl:col-span-3"><Button type="submit" disabled={creating} data-testid="button-save-student">{creating ? 'Enrolling…' : <><Plus size={15} /> Enroll student</>}</Button></div></form>{error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-enroll-error">{error}</p>}{notice && <p className="mt-3 rounded-md bg-accent/15 px-3 py-2 text-sm font-medium text-primary" data-testid="status-enroll-success">{notice}</p>}</section></>;
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
  const [branch, setBranch] = useState<string>('');
  const [, setLocation] = useLocation();
  const students = useListStudents(undefined, { query: { queryKey: getListStudentsQueryKey(undefined) } });
  const [remarkFor, setRemarkFor] = useState<Student | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const statusFor = useStudentStatus('/api/admin/students/status', refreshToken);
  const refresh = () => { setRefreshToken((v) => v + 1); queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() }); void students.refetch(); };
  const branches = useBranches();
  const branchList = branches ?? [];
  const zedking = branchList.find((b) => b.name === 'Zedking');
  // Same table as the module desk, so the two portals read identically.
  const query = search.trim().toLowerCase();
  const branchOf = (student: Student) => student.branchId ?? zedking?.id ?? null;
  const rows = (students.data ?? []).filter((student) =>
    (branch === '' || String(branchOf(student)) === branch)
    && studentMatches(student, query),
  );
  return <>
    <PageHeader kicker="Admin / student room" title="Student list" detail="Open a student to see their full record, photo and sign-in details." />
    {branchList.length > 0 && <label className="mb-3 grid w-72 gap-1.5 text-sm font-medium">Branch<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="select-students-branch"><option value="">— All branches —</option>{branchList.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}</select></label>}
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

function BranchAddStudentPage() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = () => {
    fetch('/api/branch/students')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data)) setStudents(data as Student[]); })
      .catch(() => undefined);
  };
  useEffect(load, []);
  // Branch offices post to /branch/students; the branch is taken from the session, so
  // the form hides its branch select and the create always lands under this branch.
  const onCreate = (data: NewStudentInput) => {
    setCreating(true);
    return fetch('/api/branch/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => { if (!ok) throw new Error('create failed'); load(); return body as Student; })
      .finally(() => setCreating(false));
  };
  return <StudentEnrolForm kicker="Branch / student room" total={students?.length ?? 0} creating={creating} photoBase="/api/branch/students" showBranch={false} onCreate={onCreate} />;
}

function BranchStudentListPage() {
  const [search, setSearch] = useState('');
  const [, setLocation] = useLocation();
  const [students, setStudents] = useState<Student[] | null>(null);
  const [remarkFor, setRemarkFor] = useState<Student | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetch('/api/branch/students')
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (ok) setStudents(data as Student[]); else setFailed(true); })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);
  const statusFor = useStudentStatus('/api/branch/students/status', refreshToken);
  const refresh = () => { setRefreshToken((v) => v + 1); load(); };
  const query = search.trim().toLowerCase();
  const rows = (students ?? []).filter((s) => studentMatches(s, query));
  return <>
    <PageHeader kicker="Branch / student room" title="Student list" detail="The students enrolled in this branch. Open a student to see their full record, photo and sign-in details." />
    <StudentSearchBar value={search} onChange={setSearch} count={rows.length} testId="input-branch-student-search" />
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-5 font-display text-2xl font-bold">All students</h2>
      {failed ? <ErrorState retry={load} />
        : students == null ? <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
        : rows.length === 0 ? <EmptyState title="No matching students" detail="Try a name, student ID, contact number or email." icon={UserRound} />
        : <StudentTable students={rows} testIdPrefix="row-branch-student" statusFor={statusFor} onRowClick={(student) => setLocation(`/branch/students/${student.id}`)} action={(student) => (
            <RecordActions student={student} base="/api/branch/students" onRemark={() => setRemarkFor(student)} onDeleted={refresh} />
          )} />}
    </section>
    {remarkFor && <RemarkPanel student={remarkFor} base="/api/branch/students" onClose={() => setRemarkFor(null)} onSaved={refresh} />}
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

const emptyProfileForm: StudentProfileForm = { fullName: '', fathersName: '', course: 'Digital Marketing with AI', dateOfJoining: '', contactNumber: '', guardianContact: '', email: '', address: '' };

function StudentDetailPage({ scope }: { scope: 'admin' | 'teacher' | 'branch' }) {
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
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<StudentProfileForm>(emptyProfileForm);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [profileError, setProfileError] = useState('');
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

  const openEdit = () => {
    setProfileError(''); setProfileNotice('');
    setProfileForm({
      fullName: student?.fullName ?? '',
      fathersName: student?.fathersName ?? '',
      course: student?.course ?? 'Digital Marketing with AI',
      dateOfJoining: student?.dateOfJoining ?? '',
      contactNumber: student?.contactNumber ?? '',
      guardianContact: student?.guardianContact ?? '',
      email: student?.email ?? '',
      address: student?.address ?? '',
    });
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setProfileError(''); setProfileNotice(''); setProfileForm(emptyProfileForm); };

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    setProfileError(''); setProfileNotice('');
    if (!profileForm.dateOfJoining) { setProfileError('Choose the joining date.'); return; }
    const joining = new Date(`${profileForm.dateOfJoining}T00:00:00Z`);
    if (Number.isNaN(joining.getTime()) || joining.toISOString().slice(0, 10) !== profileForm.dateOfJoining) { setProfileError('That joining date does not exist. Check the day against the month.'); return; }
    const emailError = validateStudentEmail(profileForm.email);
    if (emailError) { setProfileError(emailError); return; }
    setProfileSaving(true);
    fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: profileForm.fullName.trim(), fathersName: profileForm.fathersName.trim(), course: profileForm.course, dateOfJoining: profileForm.dateOfJoining, contactNumber: profileForm.contactNumber.trim(), email: profileForm.email.trim().toLowerCase(), address: profileForm.address.trim() || null, guardianContact: profileForm.guardianContact.trim() || null }) })
      .then((res) => res.json().then((body) => ({ ok: res.ok, status: res.status, body })))
      .then(({ ok, status, body }) => {
        if (!ok) { if (status === 409) throw new Error('An account with this email already exists.'); throw new Error('save failed'); }
        setStudent(body as Student);
        setEditing(false);
        setProfileForm(emptyProfileForm);
        setProfileNotice('Profile updated.');
        setReportToken((v) => v + 1);
      })
      .catch((err) => setProfileError(err instanceof Error && err.message === 'An account with this email already exists.' ? err.message : 'We could not save those details. Try again.'))
      .finally(() => setProfileSaving(false));
  };

  const backHref = scope === 'admin' ? '/admin/students/enrolled' : scope === 'branch' ? '/branch/students' : '/teacher/students';
  const recordKicker = scope === 'admin' ? 'Admin' : scope === 'branch' ? 'Branch' : 'Teacher';
  if (loadError) return <><PageHeader kicker={`${recordKicker} / student record`} title="Student record" detail="We could not open this record." /><ErrorState retry={load} /></>;
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
    <PageHeader kicker={`${recordKicker} / student record`} title={student.fullName} detail="The full record, the photo, and the sign-in details for this learner." action={<div className="flex items-center gap-3">{!editing && <Button type="button" size="sm" variant="outline" onClick={openEdit} data-testid="button-edit-student-profile"><Pencil size={14} /> Edit profile</Button>}<StudentAvatar student={student} size={48} /></div>} />
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <div className="grid gap-6">
      <section className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold text-primary">Student record</p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">Complete information</h2>
        </div>
        {editing ? <form onSubmit={saveProfile} className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="form-edit-student-profile">
          <Field label="Full name" value={profileForm.fullName} onChange={(e) => setProfileForm((v) => ({ ...v, fullName: e.target.value }))} minLength={2} required data-testid="input-edit-full-name" />
          <Field label="Father&apos;s name" value={profileForm.fathersName} onChange={(e) => setProfileForm((v) => ({ ...v, fathersName: e.target.value }))} minLength={2} required data-testid="input-edit-fathers-name" />
          <label className="grid gap-1.5 text-sm font-medium">Course<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={profileForm.course} onChange={(e) => setProfileForm((v) => ({ ...v, course: e.target.value }))} data-testid="select-edit-course"><option>Digital Marketing with AI</option></select></label>
          <JoiningDateField value={profileForm.dateOfJoining} onChange={(iso) => setProfileForm((v) => ({ ...v, dateOfJoining: iso }))} />
          <Field label="Contact number" value={profileForm.contactNumber} onChange={(e) => setProfileForm((v) => ({ ...v, contactNumber: e.target.value }))} minLength={6} maxLength={12} required data-testid="input-edit-contact" />
          <Field label="Parent / guardian contact" value={profileForm.guardianContact} onChange={(e) => setProfileForm((v) => ({ ...v, guardianContact: e.target.value }))} maxLength={12} placeholder="Optional" data-testid="input-edit-guardian-contact" />
          <div className="sm:col-span-2"><Field label="Email address" type="email" value={profileForm.email} onChange={(e) => setProfileForm((v) => ({ ...v, email: e.target.value }))} required data-testid="input-edit-email" /></div>
          <div className="sm:col-span-2"><label className="grid gap-1.5 text-sm font-medium">Address<Textarea rows={2} placeholder="Optional — house, street, city, pin code" value={profileForm.address} onChange={(ev) => setProfileForm((v) => ({ ...v, address: ev.target.value }))} data-testid="input-edit-address" /></label></div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={profileSaving} data-testid="button-save-student-profile">{profileSaving ? 'Saving…' : 'Save changes'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={cancelEdit} disabled={profileSaving} data-testid="button-cancel-student-profile">Cancel</Button>
          </div>
        </form> : <dl className="mt-6 grid gap-0 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="border-b border-border/70 py-4 pr-4" data-testid={`detail-${label.toLowerCase().replaceAll(' ', '-')}`}>
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
        </div>)}</dl>}
        {profileError && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-profile-error">{profileError}</p>}
        {profileNotice && <p className="mt-4 rounded-md bg-accent/15 px-3 py-2 text-sm font-medium text-primary" data-testid="status-profile-success">{profileNotice}</p>}
      </section>

      {/* The report is the only panel here now. Marks are entered from Mark Assessment in
          the sidebar, one project across the whole roster. */}
      <section className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold text-primary">Attendance</p>
        <h2 className="mt-1 font-display text-2xl font-bold">Mark Attendance</h2>
        <StudentProgressSection key={reportToken} base={base} moduleFilter={moduleFilter} />
      </section>
      </div>

      {/* self-start so the card is only as tall as its content. It used to stretch to the
          left column and leave a blank box under the remark. */}
      <div className="grid gap-6 self-start">
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
  const { data: adminUser } = useCurrentUser();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  // The server verifies the current password against Supabase before setting the new
  // one — same account the admin signs in with, so both sides stay in sync.
  const handlePassword = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(''); setError('');
    if (form.next !== form.confirm) { setError('The new passwords do not match.'); return; }
    if (form.next.length < 8) { setError('Use at least 8 characters for the new password.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/account/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'We could not update the password. Try again.');
      }
      setForm({ current: '', next: '', confirm: '' });
      setNotice('Admin password updated. Use it the next time you sign in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not update the password. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageHeader kicker="Admin / settings" title="Settings" detail="Account security for the admin sign-in." action={<div className="flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/15 px-3 py-2 text-xs font-semibold text-primary"><ShieldCheck size={15} /> Admin only</div>} />
    <div className="grid gap-6">
      <section className="max-w-xl rounded-xl border border-border bg-card p-5">
        <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Account security</p>
        <h2 className="mt-1 font-display text-2xl font-bold">Reset admin password</h2>
        <p className="mt-2 text-sm text-muted-foreground">This changes the password you sign in with{adminUser?.email ? ` (${adminUser.email})` : ''}. Enter the current one to confirm it is you.</p>
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

function randomPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (value) => chars[value % chars.length]).join('');
}

function Home() {
  const { data: user, isLoading } = useCurrentUser();
  const login = useLogin();
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (user?.role === 'student') setLocation('/student'); else if (user?.role === 'branch') setLocation('/branch'); }, [user, setLocation]);
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
  const { data: localAdmin } = useCurrentUser();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });

  useEffect(() => { if (localAdmin?.role === 'admin') setLocation('/admin/dashboard'); }, [localAdmin, setLocation]);

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/admin/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim(), password: form.password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Invalid credentials. Please try again.');
      }
      const me = await res.json();
      queryClient.setQueryData(currentUserQueryKey('admin'), me);
      setLocation('/admin/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
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
  // The exchange endpoint is gone: admin login already goes through the server, so
  // the local admin session is the only source of truth. Ready means the current-user
  // query finished resolving, so Protected does not redirect on first paint.
  return { admin: user?.role === 'admin' ? user : undefined, ready: !enabled || !isLoading };
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

function BranchLoginPage({ branch }: { branch: { id: number; name: string; username?: string | null } }) {
  const [, setLocation] = useLocation();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSignIn = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'branch', identifier: userId.trim(), password }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error((data as { error?: string })?.error ?? 'Invalid credentials.');
        queryClient.setQueryData(currentUserQueryKey('branch'), data);
        setLocation('/branch');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };
  if (branch) {
    return <AuthLayout eyebrow={`${branch.name} Sign In`}>
      <div className="mb-8 flex items-center justify-between lg:hidden"><Logo /><Link href="/" className="text-sm font-semibold text-primary" data-testid="link-branch-back-home">Back to home</Link></div>
      <Link href="/" className="mb-8 hidden items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground lg:flex" data-testid="link-branch-back-home-lg"><ChevronLeft size={16} /> Back to home</Link>
      <p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">Welcome back</p>
      <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">Sign in to the {branch.name} desk.</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Use the user ID and password your institute admin created for this branch.</p>
      <form onSubmit={handleSignIn} className="mt-7 grid gap-4">
        <Field label="User ID" type="text" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={branch.username ?? 'Your user ID'} autoComplete="username" required data-testid="input-branch-login-username" />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" required data-testid="input-branch-login-password" toggleTestId="button-toggle-branch-login-pwd" />
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-branch-login-error">{error}</p>}
        <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full" data-testid="button-submit-branch-login">{loading ? 'Signing in…' : 'Sign in'} <ArrowRight /></Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">Restricted access — keep these credentials with the institute.</p>
    </AuthLayout>;
  }
  return <AuthLayout eyebrow="Branch desk">
    <h2 className="font-display text-4xl font-bold tracking-tight">Branch desk not found.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">That page isn&apos;t one of the branches this institute runs. Check the spelling, or contact the institute admin.</p>
    <Link href="/" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary" data-testid="link-branch-missing-home"><ChevronLeft size={16} /> Back to home</Link>
  </AuthLayout>;
}

// The branch desk reads its own modules straight from the server (scoped by the
// session's branchId), not from a name match against the catalog. The dashboard and
// the course-files page share this so both always show the same branch's modules.
function useBranchOverview() {
  const [overview, setOverview] = useState<BranchOverview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetch('/api/branch/overview')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setOverview(data as BranchOverview); else if (alive) setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  return { overview, failed };
}

type BranchOverview = {
  branchName: string;
  totalStudents: number;
  attendanceMarked: number;
  attendancePending: number;
  assessmentMarked: number;
  assessmentPending: number;
  modules: { id: string; name: string; attendanceMarked: number; assessmentMarked: number }[];
};

function BranchPage() {
  const { overview, failed } = useBranchOverview();
  return <>
    <PageHeader kicker="Branch desk" title={overview?.branchName ?? 'Branch desk'} detail="The course modules this branch runs. Click a module to manage instructors, attendance, and marks." />
    <section>
      <h2 className="font-display text-2xl font-bold">Modules</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {overview == null && !failed && [1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}
        {(overview?.modules ?? []).map((mod) => (
          <Link key={mod.id} href={`/branch/module/${mod.id}`} className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-accent hover:bg-accent/5" data-testid={`card-branch-module-${mod.id}`}>
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Module</p>
            <h3 className="mt-1 font-display text-lg font-bold">{mod.id.toUpperCase()} · {mod.name}</h3>
            <p className="mt-3 text-xs text-muted-foreground">{mod.attendanceMarked} with attendance · {mod.assessmentMarked} with marks</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowRight size={14} /> Open</span>
          </Link>
        ))}
        {overview != null && overview.modules.length === 0 && <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground md:col-span-3">No modules in this branch yet.</p>}
      </div>
    </section>
    {failed && <p className="mt-8 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-branch-error">Could not load the branch.</p>}
  </>;
}

function BranchModuleDetailPage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as Module;
  const catalog = useCatalogModules();
  const meta = catalog.find((m) => m.key === moduleKey);
  const teachers = useListTeachers();
  const create = useCreateTeacher();
  const update = useUpdateTeacher();
  const remove = useDeleteTeacher();

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

  const verifyAdmin = () => {
    if (!pending || !confirmPwd) return;
    const target = pending.teacher;
    const action = pending.type;
    setConfirmBusy(true); setConfirmError('');
    void fetch('/api/admin/account/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: confirmPwd }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('The admin password is incorrect.');
        if (action === 'reveal') {
          setRevealedIds((v) => [...v, target.id]);
          setPending(null); setConfirmPwd(''); setConfirmBusy(false);
        } else if (action === 'password') {
          void update.mutate({ id: target.id, password: newPwd }, { onSuccess: () => { closePwdEdit(); setPending(null); setConfirmPwd(''); refresh(); } });
        } else if (action === 'delete') {
          void remove.mutate(target.id, { onSuccess: () => { setPending(null); setConfirmPwd(''); refresh(); } });
        }
      })
      .catch((e) => { setConfirmError(e.message); setConfirmBusy(false); });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    void create.mutate({ ...form, module: moduleKey }, {
      onSuccess: (teacher) => {
        setJustCreated({ displayName: teacher.displayName, username: teacher.username, password: form.password });
        setJustCreatedShown(true);
        setForm({ displayName: '', username: '', password: '' });
        setShowForm(false);
        refresh();
      },
      onError: (e) => setError(apiErrorMessage(e, 'Could not create login.')),
    });
  };

  if (!meta) return <><PageHeader kicker="Branch / module" title="Module not found." detail="That module does not exist." /></>;

  return <>
    <PageHeader kicker={`Branch / ${moduleShort[moduleKey]} desk`} title={meta.name} detail="Instructor logins for this module. Create, reveal, change password, or delete — each action needs your admin password." action={showForm ? <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setForm({ displayName: '', username: '', password: '' }); }}>Cancel</Button> : <Button size="sm" onClick={() => { setShowForm(true); setJustCreated(null); setJustCreatedShown(false); }}><Plus size={14} /> Create login</Button>} />
    {error && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-teacher-error">{error}</p>}
    {success && <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-teacher-success">{success}</p>}
    {justCreated && justCreatedShown && (
      <div className="mb-4 rounded-xl border border-accent bg-accent/5 p-4" data-testid="banner-just-created">
        <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Login created — shown once</p>
        <p className="mt-1 font-semibold">{justCreated.displayName}</p>
        <p className="text-sm font-mono-ui">User ID: {justCreated.username}</p>
        <p className="text-sm font-mono-ui">Password: {justCreated.password}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setJustCreatedShown(false)}>Dismiss</Button>
      </div>
    )}
    {showForm && (
      <div className="mb-6 rounded-xl border border-border bg-card p-5" data-testid="form-create-teacher">
        <h3 className="font-display text-lg font-bold">Create instructor login</h3>
        <form onSubmit={handleCreate} className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Name"><Input value={form.displayName} onChange={(e) => setForm((v) => ({ ...v, displayName: e.target.value }))} required maxLength={100} placeholder="e.g. Priya Sharma" /></Field>
          <Field label="User ID"><Input value={form.username} onChange={(e) => setForm((v) => ({ ...v, username: e.target.value }))} required maxLength={50} placeholder="e.g. priya.ai" pattern="^[a-zA-Z0-9._-]+$" /></Field>
          <PasswordField label="Password (min 6)" toggleTestId="input-teacher-pwd-create" value={form.password} onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))} required minLength={6} />
          <div className="sm:col-span-3 flex gap-2"><Button type="submit" disabled={create.isPending}><Loader2 size={14} className="mr-2 animate-spin" /> Creating…</Button><Button type="button" variant="outline" onClick={() => { setShowForm(false); setForm({ displayName: '', username: '', password: '' }); }}>Cancel</Button></div>
        </form>
      </div>
    )}
    <div className="grid gap-4 lg:grid-cols-2">
      {moduleTeachers.map((teacher) => (
        <div key={teacher.id} className="rounded-xl border border-border bg-card p-5" data-testid={`card-teacher-${teacher.id}`}>
          <div className="flex items-center justify-between">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">{designation}</p>
            <span className="rounded-full px-2.5 py-1 font-mono-ui text-[10px] bg-accent/20 text-primary">Active</span>
          </div>
          <h3 className="mt-2 font-display text-xl font-bold">{teacher.displayName || teacher.username}</h3>
          <p className="mt-1 text-sm font-mono-ui text-muted-foreground">User ID: {teacher.username}</p>
          <div className="mt-3 flex items-center gap-2">
            <PasswordField label="Password" toggleTestId={`input-teacher-pwd-${teacher.id}`} value={revealedIds.includes(teacher.id) ? teacher.plainPassword || '' : '••••••••'} readOnly onChange={() => {}} />
            {!revealedIds.includes(teacher.id) ? (
              <Button size="sm" variant="outline" onClick={() => { setPending({ type: 'reveal', teacher }); setConfirmPwd(''); setConfirmError(''); }}><Eye size={14} /> Reveal</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setRevealedIds((v) => v.filter((id) => id !== teacher.id))}><EyeOff size={14} /> Hide</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => { setPwdEditId(teacher.id); setNewPwd(''); setNewPwdShown(false); }}><Key size={14} /> Change</Button>
            <Button size="sm" variant="destructive" onClick={() => { setPending({ type: 'delete', teacher }); setConfirmPwd(''); setConfirmError(''); }}><Trash2 size={14} /> Delete</Button>
          </div>
          {pwdEditId === teacher.id && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="form-teacher-pwd-edit">
              <PasswordField label="New password (min 6)" toggleTestId={`input-teacher-newpwd-${teacher.id}`} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} required minLength={6} />
              <div className="sm:col-span-2 flex gap-2"><Button size="sm" onClick={() => { setPending({ type: 'password', teacher }); setConfirmPwd(''); setConfirmError(''); }} disabled={newPwd.length < 6 || confirmBusy}>Save <Loader2 size={14} className={confirmBusy ? 'mr-2 animate-spin' : 'hidden'} /></Button><Button size="sm" variant="outline" onClick={closePwdEdit}>Cancel</Button></div>
            </div>
          )}
        </div>
      ))}
      {moduleTeachers.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center lg:col-span-2">
          <p className="text-muted-foreground">No instructor logins for this module yet.</p>
          <Button className="mt-3" size="sm" onClick={() => setShowForm(true)}><Plus size={14} /> Create first login</Button>
        </div>
      )}
    </div>
    {pending && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="modal-admin-verify">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
          <h3 className="font-display text-lg font-bold">Confirm with your admin password</h3>
          <p className="mt-1 text-sm text-muted-foreground">{pending.type === 'reveal' ? `Reveal password for ${pending.teacher.username}` : pending.type === 'password' ? `Change password for ${pending.teacher.username}` : `Delete login ${pending.teacher.username}`}</p>
          <PasswordField label="Admin password" toggleTestId="input-admin-verify" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} required minLength={6} className="mt-4" />
          {confirmError && <p className="mt-2 text-sm text-destructive" data-testid="text-admin-verify-error">{confirmError}</p>}
          <div className="mt-4 flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setPending(null); setConfirmPwd(''); }}>Cancel</Button>
            <Button onClick={verifyAdmin} disabled={confirmBusy || !confirmPwd}><Loader2 size={14} className={confirmBusy ? 'mr-2 animate-spin' : 'hidden'} /> Confirm</Button>
          </div>
        </div>
      </div>
    )}
  </>;
}

function BranchModuleReportPage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as Module;
  const catalog = useCatalogModules();
  const meta = catalog.find((m) => m.key === moduleKey);
  const [monthKey, setMonthKey] = useState(() => todayIso().slice(0, 7));
  const [summary, setSummary] = useState<{ month: string; months: string[]; totalStudents: number; marked: number; expected: number; pending: number; assessmentMarked: number; projects: { project: number; marked: number }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/branch/modules/${moduleKey}/attendance/summary?month=${monthKey}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setSummary(data); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [moduleKey, monthKey]);
  if (!meta) return <><PageHeader kicker="Branch / module report" title="Module not found." detail="That module does not exist." /></>;
  const total = summary?.totalStudents ?? 0;
  const expected = summary?.expected ?? 0;
  const projects = summary?.projects ?? [];
  const projectsMeta = projects.map((p, i) => {
    const status = total > 0 && p.marked === total ? 'Submitted' : p.marked > 0 ? 'Partial' : 'Pending';
    return { ...p, index: i + 1, status };
  });
  return <>
    <PageHeader kicker={`Branch / ${moduleShort[moduleKey]} report`} title={`${meta.name}`} detail="Live status for this module — cohort size, register coverage, and the month's projects." action={<label className="grid gap-1.5 text-sm font-medium">Month<select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} data-testid="select-report-month">{(summary?.months ?? [todayIso().slice(0, 7)]).map((m) => <option key={m} value={m}>{monthNameFromKey(m)}</option>)}</select></label>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Students" value={total} detail="enrolled this month" icon={Users} accent /><StatCard label="Attendance marked" value={summary ? `${summary.marked}/${expected}` : '—'} detail="records captured this month" icon={CalendarCheck2} /><StatCard label="Attendance pending" value={summary?.pending ?? '—'} detail="records yet to be filled" icon={Clock} /><StatCard label="Project entries" value={summary?.assessmentMarked ?? '—'} detail="marks entered this month" icon={ClipboardCheck} /></div>
    <section className="mt-8 rounded-xl border border-border bg-card p-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">This month</p><h2 className="mt-1 font-display text-2xl font-bold">Projects status</h2><p className="mt-2 text-sm text-muted-foreground">Whether each of the month's two projects has been submitted by the module owner.</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2">{summary === null || !summary ? [1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />) : projectsMeta.map((p) => <div key={p.project} className="rounded-xl border border-border p-5" data-testid={`project-${p.index}`}><div className="flex items-center justify-between"><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Project {p.index}</p><span className={`rounded-full px-2.5 py-1 font-mono-ui text-[10px] ${p.status === 'Submitted' ? 'bg-accent/20 text-primary' : p.status === 'Partial' ? 'bg-muted text-foreground' : 'bg-destructive/10 text-destructive'}`}>{p.status}</span></div><h3 className="mt-2 font-display text-xl font-bold">{monthNameFromKey(monthKey)} · project {p.project}</h3><p className="mt-1 text-sm text-muted-foreground">{p.marked} of {total} students submitted</p></div>)}</div></section>
  </>;
}

function BranchModuleRoute() {
  const { data: user } = useCurrentUser();
  return user ? <BranchModuleDetailPage /> : null;
}

function BranchModuleReportRoute() {
  const { data: user } = useCurrentUser();
  return user ? <BranchModuleReportPage /> : null;
}

function Router() {
  const [pathname] = useLocation();
  // A route change resets the scroll: staying where you were (say, halfway down a
  // long student list) would make the opened detail screen start in the middle.
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [pathname]);
  return <ErrorBoundary resetKey={pathname}><Switch><Route path="/" component={Home} /><Route path="/admin" component={AdminLoginPage} /><Route path="/admin/login" component={AdminLoginPage} /><Route path="/student/login" component={StudentAuthPage} /><Route path="/admin/dashboard"><Protected role="admin"><AdminModulesPage /></Protected></Route><Route path="/admin/dashboard/:module"><Protected role="admin"><AdminModuleReportPage /></Protected></Route><Route path="/admin/module/:module"><Protected role="admin"><ModuleDetailPage /></Protected></Route><Route path="/admin/settings"><Protected role="admin"><AdminSettingsPage /></Protected></Route><Route path="/admin/panel-logins"><Protected role="admin"><AdminPanelLoginsPage /></Protected></Route><Route path="/admin/students"><Protected role="admin"><AdminStudentsPage /></Protected></Route><Route path="/admin/students/enrolled"><Protected role="admin"><AdminEnrolledPage /></Protected></Route><Route path="/admin/students/:id"><Protected role="admin"><StudentDetailPage scope="admin" /></Protected></Route><Route path="/admin/announcements"><Protected role="admin"><AdminAnnouncementsFromRoute /></Protected></Route><Route path="/admin/documents"><Protected role="admin"><AdminDocumentsFromRoute /></Protected></Route><Route path="/admin/branches"><Protected role="admin"><AdminBranchesPage /></Protected></Route><Route path="/admin/branch/:id"><Protected role="admin"><AdminBranchPage /></Protected></Route><Route path="/admin/:panel"><ModulePanelRoute /></Route><Route path="/teacher/add-student"><Protected role="teacher"><TeacherAddStudentFromRoute /></Protected></Route><Route path="/teacher/attendance"><Protected role="teacher"><TeacherAttendanceFromRoute /></Protected></Route><Route path="/teacher/assessment"><Protected role="teacher"><TeacherAssessmentFromRoute /></Protected></Route><Route path="/teacher/announcements"><Protected role="teacher"><TeacherAnnouncementsFromRoute /></Protected></Route><Route path="/teacher/documents"><Protected role="teacher"><TeacherDocumentsFromRoute /></Protected></Route><Route path="/teacher/students"><Protected role="teacher"><TeacherStudentListFromRoute /></Protected></Route><Route path="/teacher/students/:id"><Protected role="teacher"><StudentDetailPage scope="teacher" /></Protected></Route><Route path="/teacher"><Protected role="teacher"><TeacherPageFromRoute /></Protected></Route><Route path="/student/profile"><Protected role="student"><StudentProfileFromRoute /></Protected></Route><Route path="/student/modules"><Protected role="student"><StudentModulesPage /></Protected></Route><Route path="/student/project"><Protected role="student"><StudentProjectPage /></Protected></Route><Route path="/student/announcements"><Protected role="student"><StudentAnnouncementsPage /></Protected></Route><Route path="/student"><Protected role="student"><StudentPageFromRoute /></Protected></Route><Route path="/branch/module/:module/report"><Protected role="branch"><BranchModuleReportRoute /></Protected></Route><Route path="/branch/module/:module"><Protected role="branch"><BranchModuleRoute /></Protected></Route><Route path="/branch/add-student"><Protected role="branch"><BranchAddStudentPage /></Protected></Route><Route path="/branch/students/:id"><Protected role="branch"><StudentDetailPage scope="branch" /></Protected></Route><Route path="/branch/students"><Protected role="branch"><BranchStudentListPage /></Protected></Route><Route path="/branch/documents"><Protected role="branch"><BranchDocumentsFromRoute /></Protected></Route><Route path="/branch/announcements"><Protected role="branch"><BranchAnnouncementsFromRoute /></Protected></Route><Route path="/branch"><Protected role="branch"><BranchPage /></Protected></Route><Route path="/:panel"><TopLevelPanelRoute /></Route><Route component={() => <div className="grid min-h-[100dvh] place-items-center p-6"><div className="text-center"><p className="font-mono-ui text-xs uppercase tracking-wider text-primary">404</p><h1 className="mt-2 font-display text-4xl font-bold">Page not found</h1><Link href="/" className="mt-5 inline-flex text-sm font-semibold text-primary" data-testid="link-not-found-home">Return home <ArrowRight size={15} /></Link></div></div>} /></Switch></ErrorBoundary>;
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

function BranchAnnouncementsFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <AnnouncementsPage user={user} scope="branch" /> : null;
}

function BranchDocumentsFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <CourseDocumentsPage user={user} scope="branch" /> : null;
}

function TeacherAttendanceFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <AttendanceRegisterPage user={user} /> : null;
}

// Marks for one project, for every student on the module roster at once. The single-student
// form still lives on the record; this is the pass you make when you have a class full of
// marks to enter and do not want to open twenty records to do it.
function AssessmentRegisterPage({ user }: { user: CurrentUser }) {
  const students = useListTeacherStudents();
  const [month, setMonth] = useState(1);
  const [project, setProject] = useState<'' | 1 | 2>('');
  const [rows, setRows] = useState<Record<string, { marks: string; feedback: string }>>({});
  // Rows are always typeable — a locked grid just looks broken. `saved` only records that a
  // row has been written, which is what puts the Edit button back on it.
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const marksBox = useRef<Record<string, HTMLInputElement | null>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cycle = project === '' ? null : (month - 1) * 2 + project;

  const load = useCallback(async (target: number) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/teacher/assessments?cycle=${target}`);
      const data = res.ok ? await res.json() as { studentId: string; marks: number | null; feedback: string | null }[] : null;
      if (data == null) { setError('Could not load this project.'); return; }
      const next: Record<string, { marks: string; feedback: string }> = {};
      for (const record of data) next[record.studentId] = { marks: record.marks == null ? '' : String(record.marks), feedback: record.feedback ?? '' };
      setRows(next);
      setSaved({});
    } catch { setError('Could not load this project.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setNotice('');
    // No project is picked for the teacher: marks overwrite silently, so that choice has to
    // be deliberate before a single row is editable.
    if (cycle == null) { setRows({}); setSaved({}); return; }
    void load(cycle);
  }, [cycle, load]);

  const all = students.data ?? [];
  const query = search.trim().toLowerCase();
  const shown = all.filter((student) => studentMatches(student, query));
  const draft = (id: string) => rows[id] ?? { marks: '', feedback: '' };

  const saveOne = async (studentId: string) => {
    if (cycle == null) return;
    const row = draft(studentId);
    setSaving(studentId); setError(''); setNotice('');
    try {
      const res = await fetch('/api/teacher/assessments/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle, records: [{ studentId, marks: row.marks === '' ? null : Number(row.marks), feedback: row.feedback }] }),
      });
      if (!res.ok) { setError('Could not save those marks. Try again.'); return; }
      setSaved((v) => ({ ...v, [studentId]: true }));
      setNotice(`Saved for ${studentId} — month ${month}, project ${project}.`);
    } catch { setError('Could not save those marks. Try again.'); }
    finally { setSaving(''); }
  };

  return <>
    <PageHeader
      kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`}
      title="Mark Assessment"
      detail="Every project on your module roster in one place. Pick the month and project, then type marks and feedback against each student and press Save."
      action={<Link href="/teacher/students" className="flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/15 px-3 py-2 text-xs font-semibold text-primary hover:bg-accent/30" data-testid="link-assessment-student-list"><Users size={15} /> Open student list</Link>}
    />

    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1.5 text-sm font-medium">Month
          <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-assessment-month">
            {[1, 2, 3, 4, 5, 6].map((m) => <option key={m} value={m}>Month {m}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">Project
          <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={project} onChange={(e) => setProject(e.target.value === '' ? '' : Number(e.target.value) === 1 ? 1 : 2)} data-testid="select-assessment-project">
            <option value="">Select project</option>
            <option value={1}>Project 1</option>
            <option value={2}>Project 2</option>
          </select>
        </label>
        <div className="relative ml-auto w-full sm:max-w-md">
          <Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} />
          <Input className="pl-9" placeholder="Search by name, student ID, contact number or email" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-assessment" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Two projects a month — the first halfway through, the second at the end. Cycle numbers never move, so month 3 project 1 stays month 3 project 1. A blank marks box saves as 'not marked'. After saving you get an Edit button on that row.</p>
    </section>

    {project === '' && <p className="mt-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="status-assessment-pick">Choose a project to load the roster and start entering marks.</p>}

    {project !== '' && <section className="mt-5 rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">Month {month} · Project {project}</h2>
        <span className="text-xs text-muted-foreground">{shown.length} student{shown.length === 1 ? '' : 's'}</span>
      </div>
      {loading ? <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
        : shown.length === 0 ? <EmptyState title="No matching students" detail={all.length === 0 ? 'Nobody is enrolled yet.' : 'Try a name, student ID, contact number or email.'} icon={UserRound} />
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm" data-testid="table-assessment">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">#</th>
                  <th className="py-2 pr-3 font-semibold">Student ID</th>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Marks</th>
                  <th className="py-2 pr-3 font-semibold">Feedback</th>
                  <th className="py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((student, index) => {
                  const row = draft(student.id);
                  const isSaved = saved[student.id] === true;
                  const setCell = (patch: Partial<{ marks: string; feedback: string }>) =>
                    setRows((v) => ({ ...v, [student.id]: { ...row, ...patch } }));
                  return <tr key={student.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 text-muted-foreground">{index + 1}</td>
                    <td className="py-2 pr-3 font-mono-ui text-xs">{student.id}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/teacher/students/${student.id}`} className="font-semibold hover:underline">{student.fullName}</Link>
                    </td>
                    <td className="py-2 pr-3">
                      <Input ref={(node) => { marksBox.current[student.id] = node; }} className="h-9 w-24" type="number" min={0} max={100} placeholder="Not marked" value={row.marks} onChange={(e) => setCell({ marks: e.target.value })} data-testid={`input-marks-${student.id}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <Input className="h-9" placeholder="Short feedback" value={row.feedback} onChange={(e) => setCell({ feedback: e.target.value })} data-testid={`input-feedback-${student.id}`} />
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <Button type="button" size="sm" onClick={() => saveOne(student.id)} disabled={saving === student.id || loading} data-testid={`button-save-marks-${student.id}`}>{saving === student.id ? 'Saving…' : isSaved ? 'Update' : 'Save'}</Button>
                        {isSaved && <>
                          <span className="text-[11px] font-medium text-emerald-700">Saved</span>
                          <Button type="button" size="sm" variant="ghost" onClick={() => {
                            // The box was never locked, so Edit only needs to say "this row is
                            // open again" and put the caret in it.
                            setSaved((v) => ({ ...v, [student.id]: false }));
                            setNotice(`Editing ${student.id} — type the new marks and press Update.`);
                            marksBox.current[student.id]?.focus();
                          }} data-testid={`button-edit-marks-${student.id}`}>Edit</Button>
                        </>}
                      </span>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
    </section>}

    {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-assessment-error">{error}</p>}
    {notice && <p className="mt-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700" data-testid="status-assessment-success">{notice}</p>}
  </>;
}

function TeacherAssessmentFromRoute() {
  const { data: user } = useCurrentUser();
  return user ? <AssessmentRegisterPage user={user} /> : null;
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
  const catalog = useCatalogModules();
  const valid = catalog.some((m) => m.key === raw) || (modules as readonly string[]).includes(raw);
  if (!valid) return <div className="grid min-h-[100dvh] place-items-center p-6"><div className="text-center"><p className="font-mono-ui text-xs uppercase tracking-wider text-primary">404</p><h1 className="mt-2 font-display text-4xl font-bold">Panel not found</h1><Link href="/" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary" data-testid="link-not-found-home">Return home <ArrowRight size={15} /></Link></div></div>;
  return <ModulePanel panel={raw as Module} />;
}

function TopLevelPanelRoute() {
  const params = useParams<{ panel: string }>();
  const raw = (params.panel ?? '').toLowerCase();
  const catalog = useCatalogModules();
  const branches = useBranches();
  // A bare /<key> is either a module panel (teacher desk) or a branch's login page.
  if (catalog.some((m) => m.key === raw) || (modules as readonly string[]).includes(raw)) return <ModulePanel panel={raw as Module} />;
  const branch = branches?.find((b) => b.name.toLowerCase() === raw || b.name.toLowerCase().replace(/\s+/g, '-') === raw || (b.username ?? '').toLowerCase() !== '' && b.username?.toLowerCase() === raw);
  if (branch) return <BranchLoginPage branch={branch} />;
  return <div className="grid min-h-[100dvh] place-items-center p-6"><div className="text-center"><p className="font-mono-ui text-xs uppercase tracking-wider text-primary">404</p><h1 className="mt-2 font-display text-4xl font-bold">Panel not found</h1><Link href="/" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary" data-testid="link-not-found-home">Return home <ArrowRight size={15} /></Link></div></div>;
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

