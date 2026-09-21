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