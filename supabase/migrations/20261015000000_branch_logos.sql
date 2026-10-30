-- Per-branch logos.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the Supabase SQL
-- editor. The API server also adds `branches.branch_logo` and teaches
-- `resolve_login_code` to return `logo_url` at boot (see
-- artifacts/api-server/src/index.ts -> ensureLoginCodes), so the column/function half
-- of this file is a no-op if you run both. The Storage bucket + policies below can
-- ONLY be created here (or by hand in the dashboard) — the API server has no Storage
-- admin rights and the local embedded Postgres has no Storage at all.
--
-- A branch logo shows ONLY on that branch's own student login page
-- (/<login_code>/student). Everywhere else keeps the Zed-Kyng wordmark. The image is
-- stored under branches/<branch_id>/ and the object path is saved in
-- branches.branch_logo.

alter table branches add column if not exists logo_path text;
alter table branches add column if not exists branch_logo text;
update branches set branch_logo = logo_path where branch_logo is null and logo_path is not null;

-- Public bucket: anyone (including anon, i.e. the branch's student login page) can
-- READ a logo, but only a signed-in admin can write one. We do NOT widen branches or
-- loosen RLS — the resolver stays SECURITY DEFINER and only ever exposes the public
-- Storage URL, never the bucket listing.
insert into storage.buckets (id, name, public)
values ('branch-logos', 'branch-logos', true)
on conflict (id) do update set public = true;

-- Read: public bucket, so anon + authenticated may SELECT objects in it.
drop policy if exists "branch_logos_public_read" on storage.objects;
create policy "branch_logos_public_read"
  on storage.objects for select
  using (bucket_id = 'branch-logos');

-- Write: only a logged-in admin (the only Supabase-authenticated user in this app) may
-- upload, replace or delete. Replacing is an update (upsert), removing is a delete.
drop policy if exists "branch_logos_admin_insert" on storage.objects;
create policy "branch_logos_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'branch-logos');

drop policy if exists "branch_logos_admin_update" on storage.objects;
create policy "branch_logos_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'branch-logos')
  with check (bucket_id = 'branch-logos');

drop policy if exists "branch_logos_admin_delete" on storage.objects;
create policy "branch_logos_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'branch-logos');

-- CREATE OR REPLACE cannot change a return type; the signature gained logo_url, so drop first.
drop function if exists resolve_login_code(text);

create or replace function resolve_login_code(code text)
returns table(type text, id text, name text, branch_name text, logo_url text)
language sql
security definer
stable
set search_path = public
as $fn$
  select 'branch'::text, b.id::text, b.name, null::text,
        case when b.branch_logo like 'data:image/%' then b.branch_logo
          when b.branch_logo is not null
              then 'https://aeywrwzpgyoatwsrtlyd.supabase.co/storage/v1/object/public/branch-logos/' || b.branch_logo
              else null end
  from branches b
  where b.login_code = lower(trim(code))
  union all
  select 'module'::text, m.id::text, m.name, br.name, null::text
  from modules m
  join branches br on br.id = m.branch_id
  where m.login_code = lower(trim(code))
  limit 1
$fn$;

revoke all on function resolve_login_code(text) from public;
grant execute on function resolve_login_code(text) to anon;
grant execute on function resolve_login_code(text) to authenticated;
