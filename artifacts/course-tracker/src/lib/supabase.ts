import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aeywrwzpgyoatwsrtlyd.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXdyd3pwZ3lvYXR3c3J0bHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjgyNDAsImV4cCI6MjEwNDYwNDI0MH0.oSIJYZvksfN-JFo_qha29J-OaQaRBmRMpUMwT7hqoJw';

export const ADMIN_EMAIL = 'zedkingservice@gmail.com';

// sessionStorage, not the default localStorage: the admin's Supabase session is
// dropped when the browser closes, matching the API's session cookies.
const sessionOnlyStorage = {
  getItem: (key: string) => {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string) => {
    try { window.sessionStorage.setItem(key, value); } catch { /* private mode */ }
  },
  removeItem: (key: string) => {
    try { window.sessionStorage.removeItem(key); } catch { /* private mode */ }
  },
};

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: sessionOnlyStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export function isAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase() === ADMIN_EMAIL;
}

// Confirm the signed-in admin's OWN password without disturbing the live session.
// A throwaway client is created with persistSession and autoRefreshToken off, so the
// password grant it performs is held only in that object's memory — the admin's real
// session in `supabase` above is never replaced or signed out, whatever the outcome.
// The password is used for this one call and is never stored, logged or rendered.
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const email = await adminEmailForVerification();
  if (!email || !password) return false;
  const ephemeral = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { data, error } = await ephemeral.auth.signInWithPassword({ email, password });
    return !error && Boolean(data?.session);
  } catch {
    return false;
  }
}

async function adminEmailForVerification(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.email) return data.session.user.email;
  } catch {
    /* private mode / no session — fall through to the known admin address */
  }
  return ADMIN_EMAIL;
}