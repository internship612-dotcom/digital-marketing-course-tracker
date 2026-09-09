import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  getGetCurrentUserQueryKey,
  getGetTeacherAssessmentsQueryKey,
  getGetTeacherAttendanceQueryKey,
  getListAllAssessmentsQueryKey,
  getListAllAttendanceQueryKey,
  getListStudentsQueryKey,
  getListTeacherStudentsQueryKey,
  getListTeachersQueryKey,
  useCreateTeacher,
  useDeleteTeacher,
  useGetAdminSummary,
  useGetCurrentUser,
  useGetStudentAssessmentReport,
  useGetStudentAttendanceReport,
  useGetTeacherAssessments,
  useGetTeacherAttendance,
  useListAllAssessments,
  useListAllAttendance,
  useListStudents,
  useListTeacherStudents,
  useListTeachers,
  useLogin,
  useLogout,
  useRegisterStudent,
  useSaveTeacherAssessments,
  useSaveTeacherAttendance,
  useUpdateTeacher,
  useUpdateAdminPassword,
  type AssessmentRecord,
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
  ChevronLeft,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();
const modules: Module[] = ['ai', 'dm', 'sm'];
const moduleNames: Record<Module, string> = { ai: 'AI marketing', dm: 'Digital marketing', sm: 'Social media' };
const moduleShort: Record<Module, string> = { ai: 'AI', dm: 'DM', sm: 'SM' };

function initials(name = 'Course Tracker') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-logo">
      <span className={`grid h-9 w-9 place-items-center rounded-lg font-display text-base font-bold ${dark ? 'bg-accent text-primary' : 'bg-primary text-primary-foreground'}`}>ct</span>
      <span className={`font-display text-lg font-bold tracking-tight ${dark ? 'text-sidebar-foreground' : 'text-foreground'}`}>course<span className={dark ? 'text-accent' : 'text-primary'}>tracker</span></span>
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

function AuthLayout({ children, eyebrow }: { children: ReactNode; eyebrow: string }) {
  return (
    <div className="app-noise min-h-[100dvh] bg-background lg:grid lg:grid-cols-[minmax(320px,0.85fr)_1.15fr]">
      <aside className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-[32px] border-accent/20" />
        <div className="absolute -bottom-20 -left-12 h-56 w-56 rounded-full border-[24px] border-accent/10" />
        <Logo dark />
        <div className="relative max-w-sm pb-8">
          <p className="font-mono-ui text-xs uppercase tracking-[0.22em] text-accent">Daily academic control room</p>
          <h1 className="mt-5 font-display text-5xl font-bold leading-[0.96]">Keep the cohort moving.</h1>
          <p className="mt-6 max-w-xs text-sm leading-6 text-sidebar-foreground/70">One reliable place for teaching records, attendance, and the small signals that make progress visible.</p>
        </div>
        <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">Digital marketing with AI · 2025</p>
      </aside>
      <main className="flex min-h-[100dvh] items-center justify-center p-5 sm:p-10"><div className="w-full max-w-md">{children}</div></main>
    </div>
  );
}

function LoginPage() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [role, setRole] = useState<Role>('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    login.mutate({ data: { role, identifier, password } }, {
      onSuccess: (user) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), user);
        setLocation(`/${user.role}`);
      },
      onError: () => setMessage('That sign-in did not work. Check the identifier and password, then try again.'),
    });
  };
  return <AuthLayout eyebrow="Sign in">
    <div className="mb-8 flex items-center justify-between lg:hidden"><Logo /><Link href="/register" className="text-sm font-semibold text-primary" data-testid="link-register-mobile">Register</Link></div>
    <p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">Welcome back</p>
    <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">Start the day in control.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Choose your workspace, then use the identifier your institute gave you.</p>
    <div className="mt-8 grid grid-cols-3 gap-2" role="tablist">
      {(['student', 'teacher', 'admin'] as Role[]).map((item) => <button key={item} type="button" role="tab" aria-selected={role === item} onClick={() => setRole(item)} className={`rounded-lg border px-2 py-3 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${role === item ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`} data-testid={`tab-role-${item}`}>{item}</button>)}
    </div>
    <form onSubmit={submit} className="mt-6 grid gap-4">
      <Field label={role === 'student' ? 'Email address' : role === 'teacher' ? 'Username' : 'Admin identifier'} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={role === 'student' ? 'you@example.com' : 'Enter identifier'} autoComplete="username" required data-testid="input-identifier" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" required data-testid="input-password" />
      {message && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-login-error">{message}</p>}
      <Button type="submit" size="lg" disabled={login.isPending} className="mt-2 w-full" data-testid="button-submit-login">{login.isPending ? 'Checking access…' : 'Enter workspace'} <ArrowRight /></Button>
    </form>
    <p className="mt-7 text-center text-sm text-muted-foreground">New student? <Link href="/register" className="font-semibold text-primary underline-offset-4 hover:underline" data-testid="link-register">Create your record</Link></p>
  </AuthLayout>;
}

function RegisterPage() {
  const [, setLocation] = useLocation();
  const register = useRegisterStudent();
  const [values, setValues] = useState({ fullName: '', fathersName: '', course: 'Digital Marketing with AI', dateOfJoining: '', contactNumber: '', email: '', password: '', confirmPassword: '' });
  const [message, setMessage] = useState('');
  const update = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (values.password !== values.confirmPassword) { setMessage('Passwords do not match.'); return; }
    setMessage('');
    register.mutate({ data: values }, { onSuccess: (user) => { queryClient.setQueryData(getGetCurrentUserQueryKey(), user); setLocation('/student'); }, onError: () => setMessage('We could not create that student record. Check the form and try again.') });
  };
  return <AuthLayout eyebrow="Registration">
    <div className="mb-8 flex items-center justify-between lg:hidden"><Logo /><Link href="/login" className="text-sm font-semibold text-primary" data-testid="link-login-mobile">Sign in</Link></div>
    <Link href="/login" className="mb-8 hidden items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground lg:flex" data-testid="link-back-login"><ChevronLeft size={16} /> Back to sign in</Link>
    <p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">New student record</p>
    <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">Make your progress count.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">A few details now gives you a clear view of every week that follows.</p>
    <form onSubmit={submit} className="mt-7 grid gap-3 sm:grid-cols-2">
      <Field label="Full name" value={values.fullName} onChange={update('fullName')} required data-testid="input-full-name" />
      <Field label="Father's name" value={values.fathersName} onChange={update('fathersName')} required data-testid="input-fathers-name" />
      <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Course<select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={values.course} onChange={(e) => setValues((v) => ({ ...v, course: e.target.value }))} data-testid="select-course"><option>Digital Marketing with AI</option></select></label>
      <Field label="Joining date" type="date" value={values.dateOfJoining} onChange={update('dateOfJoining')} required data-testid="input-joining-date" />
      <Field label="Contact number" value={values.contactNumber} onChange={update('contactNumber')} required data-testid="input-contact" />
      <div className="sm:col-span-2"><Field label="Email address" type="email" value={values.email} onChange={update('email')} required data-testid="input-email" /></div>
      <Field label="Create password" type="password" value={values.password} onChange={update('password')} minLength={6} required data-testid="input-register-password" />
      <Field label="Confirm password" type="password" value={values.confirmPassword} onChange={update('confirmPassword')} minLength={6} required data-testid="input-confirm-password" />
      {message && <p className="sm:col-span-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-register-error">{message}</p>}
      <Button type="submit" size="lg" disabled={register.isPending} className="mt-3 sm:col-span-2" data-testid="button-submit-register">{register.isPending ? 'Creating record…' : 'Create student record'} <ArrowRight /></Button>
    </form>
  </AuthLayout>;
}

function Shell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const [, setLocation] = useLocation();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = user.role === 'admin' ? [{ href: '/admin', label: 'Overview', icon: LayoutDashboard }] : user.role === 'teacher' ? [{ href: '/teacher', label: 'Teaching desk', icon: BookOpen }] : [{ href: '/student', label: 'My progress', icon: BarChart3 }];
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { queryClient.setQueryData(getGetCurrentUserQueryKey(), undefined); setLocation('/login'); } });
  return <div className="app-noise min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar p-5 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between"><Logo dark /><button className="rounded-md p-2 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-menu"><X size={18} /></button></div>
      <div className="mt-12"><p className="font-mono-ui text-[10px] uppercase tracking-[0.22em] text-sidebar-foreground/45">Workspace</p><nav className="mt-3 grid gap-1">{nav.map(({ href, label, icon: Icon }) => <Link href={href} key={href} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" data-testid={`link-nav-${user.role}`}><Icon size={17} />{label}</Link>)}</nav></div>
      <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-xs font-bold text-primary">{initials(user.displayName)}</span><div className="min-w-0"><p className="truncate text-sm font-semibold" data-testid="text-current-user">{user.displayName}</p><p className="font-mono-ui text-[10px] uppercase tracking-wider text-sidebar-foreground/55">{user.role}{user.module ? ` · ${moduleShort[user.module]}` : ''}</p></div></div><button onClick={signOut} className="mt-4 flex w-full items-center gap-2 rounded-md px-1 text-xs text-sidebar-foreground/55 hover:text-accent" data-testid="button-logout"><LogOut size={14} /> Sign out</button></div>
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

function AdminPage() {
  const summary = useGetAdminSummary();
  const teachers = useListTeachers();
  const [search, setSearch] = useState('');
  const students = useListStudents(search ? { search } : undefined, { query: { queryKey: getListStudentsQueryKey(search ? { search } : undefined) } });
  const attendance = useListAllAttendance();
  const assessments = useListAllAssessments();
  const create = useCreateTeacher();
  const update = useUpdateTeacher();
  const remove = useDeleteTeacher();
  const updatePassword = useUpdateAdminPassword();
  const [teacherForm, setTeacherForm] = useState({ username: '', password: '', displayName: '', module: 'ai' as Module });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const saveTeacher = (event: FormEvent) => {
    event.preventDefault();
    if (editingId) update.mutate({ id: editingId, data: { username: teacherForm.username, displayName: teacherForm.displayName, module: teacherForm.module, ...(teacherForm.password ? { password: teacherForm.password } : {}) } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListTeachersQueryKey() }); setEditingId(null); setTeacherForm({ username: '', password: '', displayName: '', module: 'ai' }); } });
    else create.mutate({ data: teacherForm }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListTeachersQueryKey() }); setTeacherForm({ username: '', password: '', displayName: '', module: 'ai' }); } });
  };
  const beginEdit = (teacher: Teacher) => {
    setTeacherForm({ username: teacher.username, displayName: teacher.displayName, module: teacher.module, password: '' });
    setEditingId(teacher.id);
  };
  const busy = summary.isLoading || teachers.isLoading;
  return <><PageHeader kicker="Admin / command view" title="Good morning, admin." detail="A quick read on the cohort, the teaching bench, and what needs attention today." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{busy ? [1, 2, 3, 4].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />) : summary.error ? <div className="sm:col-span-2 xl:col-span-4"><ErrorState retry={() => summary.refetch()} /></div> : <><StatCard label="Students" value={summary.data?.studentCount ?? 0} detail="active in this cohort" icon={Users} accent /><StatCard label="Teachers" value={summary.data?.teacherCount ?? 0} detail="module owners" icon={GraduationCap} /><StatCard label="Attendance" value={summary.data?.attendanceCount ?? 0} detail="records captured" icon={CalendarCheck2} /><StatCard label="Assessments" value={summary.data?.assessmentCount ?? 0} detail="marks entered" icon={ClipboardCheck} /></>}</div>
    <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_1.35fr]">
      <section className="rounded-xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-4"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Teaching bench</p><h2 className="mt-1 font-display text-2xl font-bold">Module owners</h2></div><span className="rounded-full bg-muted px-2.5 py-1 font-mono-ui text-[10px] text-muted-foreground">{teachers.data?.length ?? 0} assigned</span></div><form onSubmit={saveTeacher} className="mt-5 grid gap-2 rounded-lg bg-muted/60 p-3"><div className="grid gap-2 sm:grid-cols-2"><Input placeholder="Display name" value={teacherForm.displayName} onChange={(e) => setTeacherForm((v) => ({ ...v, displayName: e.target.value }))} required data-testid="input-teacher-name" /><Input placeholder="Username" value={teacherForm.username} onChange={(e) => setTeacherForm((v) => ({ ...v, username: e.target.value }))} required data-testid="input-teacher-username" /></div><div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input placeholder={editingId ? 'New password (optional)' : 'Password'} type="password" value={teacherForm.password} onChange={(e) => setTeacherForm((v) => ({ ...v, password: e.target.value }))} required={!editingId} data-testid="input-teacher-password" /><select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={teacherForm.module} onChange={(e) => setTeacherForm((v) => ({ ...v, module: e.target.value as Module }))} data-testid="select-teacher-module">{modules.map((m) => <option key={m} value={m}>{moduleNames[m]}</option>)}</select><Button type="submit" size="sm" disabled={create.isPending || update.isPending} data-testid="button-save-teacher">{editingId ? 'Update' : <><Plus size={15} /> Add</>}</Button></div>{editingId && <button type="button" onClick={() => { setEditingId(null); setTeacherForm({ username: '', password: '', displayName: '', module: 'ai' }); }} className="text-left text-xs text-muted-foreground hover:text-foreground" data-testid="button-cancel-teacher">Cancel editing</button>}</form><div className="mt-4 divide-y divide-border">{teachers.data?.map((teacher) => <div key={teacher.id} className="flex items-center gap-3 py-3" data-testid={`row-teacher-${teacher.id}`}><span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{initials(teacher.displayName)}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{teacher.displayName}</p><p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">@{teacher.username} · {moduleShort[teacher.module]}</p></div><button onClick={() => { setEditingId(teacher.id); beginEdit(teacher); }} className="rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-muted" data-testid={`button-edit-teacher-${teacher.id}`}>Edit</button><button onClick={() => { if (window.confirm(`Remove ${teacher.displayName}?`)) remove.mutate({ id: teacher.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListTeachersQueryKey() }) }); }} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove ${teacher.displayName}`} data-testid={`button-delete-teacher-${teacher.id}`}><Trash2 size={15} /></button></div>)}</div>{teachers.data?.length === 0 && <div className="mt-4"><EmptyState title="No teachers assigned" detail="Add the first module owner above." icon={GraduationCap} /></div>}</section>
      <section className="rounded-xl border border-border bg-card p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Cohort register</p><h2 className="mt-1 font-display text-2xl font-bold">Student oversight</h2></div><div className="relative"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} /><Input className="pl-9" placeholder="Search students" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-students" /></div></div>{students.isError ? <div className="mt-5"><ErrorState retry={() => students.refetch()} /></div> : students.data?.length === 0 ? <div className="mt-5"><EmptyState title="No matching students" detail="Try a different name or email." icon={UserRound} /></div> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead className="border-b border-border font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="pb-3">Student</th><th className="pb-3">Course</th><th className="pb-3">Joined</th><th className="pb-3">Contact</th></tr></thead><tbody className="divide-y divide-border">{students.data?.map((student) => <tr key={student.id} className="group" data-testid={`row-student-${student.id}`}><td className="py-3"><p className="font-semibold">{student.fullName}</p><p className="text-xs text-muted-foreground">{student.email}</p></td><td className="py-3 text-xs text-muted-foreground">{student.course}</td><td className="py-3 font-mono-ui text-xs text-muted-foreground">{student.dateOfJoining}</td><td className="py-3 text-xs text-muted-foreground">{student.contactNumber}</td></tr>)}</tbody></table></div>}<div className="mt-8 grid grid-cols-2 gap-3 border-t border-border pt-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">Module balance</p><div className="mt-3 flex gap-2">{modules.map((m) => <div key={m} className="flex-1 rounded-lg bg-muted p-3"><p className="font-display text-xl font-bold">{summary.data?.moduleCounts?.[m] ?? 0}</p><p className="text-xs text-muted-foreground">{moduleShort[m]}</p></div>)}</div></div><div><p className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">Recent records</p><p className="mt-3 font-display text-xl font-bold">{(attendance.data?.length ?? 0) + (assessments.data?.length ?? 0)}</p><p className="text-xs text-muted-foreground">attendance + assessments</p></div></div></section>
     </div><section className="mt-6 rounded-xl border border-border bg-card p-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Account security</p><h2 className="mt-1 font-display text-2xl font-bold">Change admin password</h2><p className="mt-2 text-sm text-muted-foreground">Keep the default setup safe by replacing the initial password before sharing the app.</p></div><form className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (passwordForm.newPassword !== passwordForm.confirmPassword) return; updatePassword.mutate({ data: { currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword } }, { onSuccess: () => setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }) }); }}><Input type="password" placeholder="Current password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((v) => ({ ...v, currentPassword: e.target.value }))} required data-testid="input-admin-current-password" /><Input type="password" placeholder="New password" minLength={6} value={passwordForm.newPassword} onChange={(e) => setPasswordForm((v) => ({ ...v, newPassword: e.target.value }))} required data-testid="input-admin-new-password" /><Input type="password" placeholder="Confirm new password" minLength={6} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((v) => ({ ...v, confirmPassword: e.target.value }))} required data-testid="input-admin-confirm-password" /><Button type="submit" disabled={updatePassword.isPending}>{updatePassword.isPending ? 'Updating…' : 'Update password'}</Button></form>{passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && <p className="mt-2 text-xs text-destructive">New passwords do not match.</p>}{updatePassword.isError && <p className="mt-2 text-xs text-destructive">The current password was not accepted.</p>}{updatePassword.isSuccess && <p className="mt-2 text-xs text-accent-foreground">Password updated successfully.</p>}</section></>;
}

function TeacherPage({ user }: { user: CurrentUser }) {
  const [week, setWeek] = useState(1);
  const [cycle, setCycle] = useState(1);
  const students = useListTeacherStudents();
  const attendance = useGetTeacherAttendance({ week }, { query: { queryKey: getGetTeacherAttendanceQueryKey({ week }), enabled: true } });
  const assessments = useGetTeacherAssessments({ cycle }, { query: { queryKey: getGetTeacherAssessmentsQueryKey({ cycle }), enabled: true } });
  const saveAttendance = useSaveTeacherAttendance();
  const saveAssessments = useSaveTeacherAssessments();
  const [attendanceMap, setAttendanceMap] = useState<Record<string, 'present' | 'absent'>>({});
  const [assessmentMap, setAssessmentMap] = useState<Record<string, { marks: string; feedback: string }>>({});
  useEffect(() => { if (attendance.data) setAttendanceMap(Object.fromEntries(attendance.data.map((record) => [record.studentId, record.status]))); }, [attendance.data]);
  useEffect(() => { if (assessments.data) setAssessmentMap(Object.fromEntries(assessments.data.map((record) => [record.studentId, { marks: record.marks == null ? '' : String(record.marks), feedback: record.feedback ?? '' }]))); }, [assessments.data]);
  const saveWeek = () => saveAttendance.mutate({ data: { week, records: (students.data ?? []).map((student) => ({ studentId: student.id, status: attendanceMap[student.id] ?? 'present' })) } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetTeacherAttendanceQueryKey({ week }) }); queryClient.invalidateQueries({ queryKey: getListAllAttendanceQueryKey() }); } });
  const saveCycle = () => saveAssessments.mutate({ data: { cycle, records: (students.data ?? []).map((student) => ({ studentId: student.id, marks: assessmentMap[student.id]?.marks === '' ? null : Number(assessmentMap[student.id]?.marks), feedback: assessmentMap[student.id]?.feedback ?? '' })) } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetTeacherAssessmentsQueryKey({ cycle }) }); queryClient.invalidateQueries({ queryKey: getListAllAssessmentsQueryKey() }); } });
  return <><PageHeader kicker={`Teacher / ${user.module ? moduleNames[user.module] : 'module desk'}`} title={`Keep ${user.module ? moduleShort[user.module] : 'your'} current.`} detail="Your daily register lives here. Save once when the room is settled; the cohort sees the change immediately." action={<div className="flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/15 px-3 py-2 text-xs font-semibold text-primary"><span className="h-2 w-2 rounded-full bg-accent" /> Live module desk</div>} /><div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"><span className="mr-2 font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">At a glance</span><span className="rounded-md bg-muted px-3 py-2 text-sm"><strong>{students.data?.length ?? 0}</strong> students</span><span className="rounded-md bg-muted px-3 py-2 text-sm"><strong>{attendance.data?.filter((r) => r.status === 'present').length ?? 0}</strong> present this week</span><span className="rounded-md bg-muted px-3 py-2 text-sm"><strong>{assessments.data?.filter((r) => r.marks != null).length ?? 0}</strong> marks entered</span></div><div className="grid gap-6 xl:grid-cols-2"><section className="rounded-xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Weekly register</p><h2 className="mt-1 font-display text-2xl font-bold">Attendance</h2></div><select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm font-semibold" value={week} onChange={(e) => setWeek(Number(e.target.value))} data-testid="select-week">{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}</select></div>{students.isLoading ? <div className="mt-5 space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div> : students.isError ? <div className="mt-5"><ErrorState retry={() => students.refetch()} /></div> : students.data?.length === 0 ? <div className="mt-5"><EmptyState title="No students in your module" detail="The admin has not assigned a student to this module yet." icon={Users} /></div> : <><div className="mt-5 divide-y divide-border">{students.data?.map((student) => <div className="flex items-center gap-3 py-3" key={student.id} data-testid={`row-attendance-${student.id}`}><span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-[10px] font-bold text-primary">{initials(student.fullName)}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{student.fullName}</p><p className="text-xs text-muted-foreground">{student.id}</p></div><button type="button" onClick={() => setAttendanceMap((m) => ({ ...m, [student.id]: 'present' }))} className={`rounded-md px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${attendanceMap[student.id] !== 'absent' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`} data-testid={`button-present-${student.id}`}><Check size={13} className="inline mr-1" /> Present</button><button type="button" onClick={() => setAttendanceMap((m) => ({ ...m, [student.id]: 'absent' }))} className={`rounded-md px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${attendanceMap[student.id] === 'absent' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'}`} data-testid={`button-absent-${student.id}`}>Absent</button></div>)}</div><Button className="mt-5 w-full" onClick={saveWeek} disabled={saveAttendance.isPending} data-testid="button-save-attendance">{saveAttendance.isPending ? 'Saving register…' : 'Save attendance'} <ArrowRight /></Button></>}</section><section className="rounded-xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">15-day check-in</p><h2 className="mt-1 font-display text-2xl font-bold">Assessments</h2></div><select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm font-semibold" value={cycle} onChange={(e) => setCycle(Number(e.target.value))} data-testid="select-cycle">{Array.from({ length: 8 }, (_, i) => <option key={i + 1} value={i + 1}>Cycle {i + 1}</option>)}</select></div>{students.data?.length === 0 ? <div className="mt-5"><EmptyState title="Nothing to assess yet" detail="Student records will appear here when your roster is assigned." icon={ClipboardCheck} /></div> : <><div className="mt-5 divide-y divide-border">{students.data?.map((student) => <div key={student.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_92px] sm:items-center" data-testid={`row-assessment-${student.id}`}><div><p className="text-sm font-semibold">{student.fullName}</p><Textarea rows={1} className="mt-2 min-h-9 resize-none text-xs" placeholder="Short feedback" value={assessmentMap[student.id]?.feedback ?? ''} onChange={(e) => setAssessmentMap((m) => ({ ...m, [student.id]: { marks: m[student.id]?.marks ?? '', feedback: e.target.value } }))} data-testid={`input-feedback-${student.id}`} /></div><Input type="number" min={0} max={100} placeholder="Marks" value={assessmentMap[student.id]?.marks ?? ''} onChange={(e) => setAssessmentMap((m) => ({ ...m, [student.id]: { marks: e.target.value, feedback: m[student.id]?.feedback ?? '' } }))} data-testid={`input-marks-${student.id}`} /></div>)}</div><Button className="mt-5 w-full" onClick={saveCycle} disabled={saveAssessments.isPending} data-testid="button-save-assessments">{saveAssessments.isPending ? 'Saving marks…' : 'Save assessment cycle'} <ArrowRight /></Button></>}</section></div></>;
}

function StudentPage({ user }: { user: CurrentUser }) {
  const attendance = useGetStudentAttendanceReport();
  const assessments = useGetStudentAssessmentReport();
  const summary = attendance.data?.summary ?? [];
  const allAssessments: AssessmentRecord[] = assessments.data ? [...assessments.data.ai, ...assessments.data.dm, ...assessments.data.sm] : [];
  const marked = allAssessments.filter((item) => item.marks != null);
  const average = marked.length ? Math.round(marked.reduce((sum, item) => sum + (item.marks ?? 0), 0) / marked.length) : null;
  return <><PageHeader kicker="Student / personal record" title={`Hello, ${user.displayName.split(' ')[0]}.`} detail="A calm view of your attendance and assessment history. Keep showing up; the record follows." action={<div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent font-bold text-primary">{initials(user.displayName)}</span><span className="text-xs font-semibold">{user.studentId ?? 'Student'}</span></div>} />{attendance.isLoading || assessments.isLoading ? <div className="grid gap-4 sm:grid-cols-3" data-testid="state-student-loading">{[1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-muted" />)}<div className="h-72 animate-pulse rounded-xl bg-muted sm:col-span-3" /></div> : attendance.isError || assessments.isError ? <ErrorState retry={() => { attendance.refetch(); assessments.refetch(); }} /> : <><div className="grid gap-4 sm:grid-cols-3"><StatCard label="Attendance" value={summary.length ? `${Math.round(summary.reduce((sum, item) => sum + item.percentage, 0) / summary.length)}%` : '—'} detail="across your modules" icon={CalendarCheck2} accent /><StatCard label="Average mark" value={average != null ? `${average}/100` : '—'} detail={`${marked.length} assessment${marked.length === 1 ? '' : 's'} marked`} icon={BarChart3} /><StatCard label="Weeks logged" value={attendance.data?.weeks.length ?? 0} detail="of your learning journey" icon={BookOpen} /></div><div className="mt-8 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]"><section className="rounded-xl border border-border bg-card p-5"><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Attendance report</p><h2 className="mt-1 font-display text-2xl font-bold">Showing up</h2><div className="mt-6 grid gap-5">{summary.map((item) => <div key={item.module} data-testid={`summary-attendance-${item.module}`}><div className="mb-2 flex items-end justify-between"><div><p className="text-sm font-semibold">{moduleNames[item.module]}</p><p className="text-xs text-muted-foreground">{item.present} of {item.recorded} sessions present</p></div><p className="font-mono-ui text-lg font-medium">{Math.round(item.percentage)}%</p></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, item.percentage)}%` }} /></div></div>)}{summary.length === 0 && <EmptyState title="Your attendance is on its way" detail="Your module teacher will start the register soon." icon={CalendarCheck2} />}</div></section><section className="rounded-xl border border-border bg-card p-5"><div className="flex items-end justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Assessment history</p><h2 className="mt-1 font-display text-2xl font-bold">Your checkpoints</h2></div><span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{allAssessments.length} records</span></div>{allAssessments.length === 0 ? <div className="mt-5"><EmptyState title="No marks entered yet" detail="Your first 15-day assessment will appear here." icon={ClipboardCheck} /></div> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead className="border-b border-border font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="pb-3">Module</th><th className="pb-3">Cycle</th><th className="pb-3">Mark</th><th className="pb-3">Feedback</th></tr></thead><tbody className="divide-y divide-border">{allAssessments.sort((a, b) => a.cycle - b.cycle).map((record, index) => <tr key={`${record.module}-${record.cycle}-${index}`} data-testid={`row-assessment-report-${record.module}-${record.cycle}`}><td className="py-4 font-semibold">{moduleShort[record.module]}</td><td className="py-4 text-muted-foreground">Cycle {record.cycle}</td><td className="py-4">{record.marks == null ? <span className="text-muted-foreground">Pending</span> : <span className={`rounded-md px-2 py-1 font-mono-ui text-xs font-medium ${record.marks >= 70 ? 'bg-accent/25 text-primary' : 'bg-destructive/10 text-destructive'}`}>{record.marks}/100</span>}</td><td className="max-w-[220px] py-4 text-xs text-muted-foreground">{record.feedback || 'No feedback yet'}</td></tr>)}</tbody></table></div>}</section></div><section className="mt-6 rounded-xl border border-border bg-card p-5"><div className="flex items-center justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-primary">Weekly rhythm</p><h2 className="mt-1 font-display text-2xl font-bold">Attendance by week</h2></div><span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">Latest first</span></div>{attendance.data?.weeks.length ? <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6 md:grid-cols-10">{[...attendance.data.weeks].reverse().map((week) => <div key={week.week} className="rounded-lg border border-border p-2 text-center" data-testid={`week-attendance-${week.week}`}><p className="font-mono-ui text-[10px] text-muted-foreground">W{week.week}</p><div className="mt-2 flex justify-center gap-1"><span className={`h-2 w-2 rounded-full ${week.ai === 'present' ? 'bg-accent' : week.ai === 'absent' ? 'bg-destructive' : 'bg-muted-foreground/30'}`} /><span className={`h-2 w-2 rounded-full ${week.dm === 'present' ? 'bg-accent' : week.dm === 'absent' ? 'bg-destructive' : 'bg-muted-foreground/30'}`} /><span className={`h-2 w-2 rounded-full ${week.sm === 'present' ? 'bg-accent' : week.sm === 'absent' ? 'bg-destructive' : 'bg-muted-foreground/30'}`} /></div></div>)}</div> : <div className="mt-5"><EmptyState title="Weekly detail will appear here" detail="Once your first week is recorded, this rhythm view will fill in." icon={CalendarCheck2} /></div>}</section></>}</>;
}

function Home() {
  const { data: user, isLoading } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const [, setLocation] = useLocation();
  useEffect(() => { if (user) setLocation(`/${user.role}`); }, [user, setLocation]);
  if (isLoading) return <LoadingScreen />;
  return <AuthLayout eyebrow="Entry point"><div className="mb-10 flex justify-between"><Logo /><Link href="/login" className="text-sm font-semibold text-primary" data-testid="link-home-login">Sign in</Link></div><p className="font-mono-ui text-xs uppercase tracking-[0.2em] text-primary">Course tracker</p><h1 className="mt-4 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl">The day gets clearer here.</h1><p className="mt-6 text-base leading-7 text-muted-foreground">Attendance, assessment, and the next useful signal — kept in one dependable place for your institute.</p><div className="mt-8 grid gap-3 sm:grid-cols-2"><Button size="lg" onClick={() => setLocation('/login')} data-testid="button-home-login">Sign in <ArrowRight /></Button><Button size="lg" variant="outline" onClick={() => setLocation('/register')} data-testid="button-home-register">Student registration</Button></div><div className="mt-12 grid grid-cols-3 gap-2 border-t border-border pt-5">{[['01', 'Admin'], ['02', 'Teacher'], ['03', 'Student']].map(([number, label]) => <div key={number}><p className="font-mono-ui text-[10px] text-primary">{number}</p><p className="mt-1 text-xs font-semibold">{label}</p></div>)}</div></AuthLayout>;
}

function Protected({ role, children }: { role: Role; children: ReactNode }) {
  const { data: user, isLoading } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const [, setLocation] = useLocation();
  useEffect(() => { if (!isLoading && (!user || user.role !== role)) setLocation(user ? `/${user.role}` : '/login'); }, [isLoading, user, role, setLocation]);
  if (isLoading || !user || user.role !== role) return <LoadingScreen label={user ? 'Opening your workspace' : 'Returning to sign in'} />;
  return <Shell user={user}>{children}</Shell>;
}

function Router() {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={Home} /><Route path="/login" component={LoginPage} /><Route path="/register" component={RegisterPage} /><Route path="/admin"><Protected role="admin"><AdminPage /></Protected></Route><Route path="/teacher"><Protected role="teacher"><TeacherPageFromRoute /></Protected></Route><Route path="/student"><Protected role="student"><StudentPageFromRoute /></Protected></Route><Route component={() => <div className="grid min-h-[100dvh] place-items-center p-6"><div className="text-center"><p className="font-mono-ui text-xs uppercase tracking-wider text-primary">404</p><h1 className="mt-2 font-display text-4xl font-bold">Page not found</h1><Link href="/" className="mt-5 inline-flex text-sm font-semibold text-primary" data-testid="link-not-found-home">Return home <ArrowRight size={15} /></Link></div></div>} /></Switch></ErrorBoundary>;
}

function TeacherPageFromRoute() {
  const { data: user } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } });
  return user ? <TeacherPage user={user} /> : null;
}

function StudentPageFromRoute() {
  const { data: user } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } });
  return user ? <StudentPage user={user} /> : null;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;