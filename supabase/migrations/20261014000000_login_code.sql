-- Shareable login codes for branches and modules.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the Supabase SQL
-- editor. The API server also applies the same DDL at boot (see
-- artifacts/api-server/src/index.ts -> ensureLoginCodes), so either path is safe and
-- running both is a no-op.
--
-- After this migration a branch/module login page opens ONLY at /<login_code>, never at
-- /<name>. `resolve_login_code` is SECURITY DEFINER, so neither table has to be made
-- publicly readable and no RLS rule is touched — anon/authenticated only ever see the
-- resolved type/id/name (plus the branch name for a module).

alter table branches add column if not exists login_code text;
alter table modules  add column if not exists login_code text;

-- Backfill every existing branch/module with a unique random 8-char code, skipping the
-- reserved route words. One DO block so branches and modules share a single "used" set,
-- because codes must be unique across BOTH tables together.
do $$
declare
  r record;
  candidate text;
  used text[];
  reserved text[] := array[
    'admin','student','teacher','branch','login','logout','signup','signin','register',
    'api','assets','static','dashboard','module','modules','settings','documents',
    'announcements','students','panel-logins','branches','project','profile','attendance',
    'assessment','reports','report','home','catalog','healthz'
  ];
begin
  select array_agg(login_code) into used from (
    select login_code from branches where login_code is not null
    union all
    select login_code from modules  where login_code is not null
  ) t;
  used := coalesce(used, array[]::text[]);

  for r in select id from branches where login_code is null loop
    loop
      candidate := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      exit when not (candidate = any(used)) and not (candidate = any(reserved));
    end loop;
    used := used || candidate;
    update branches set login_code = candidate where id = r.id;
  end loop;

  for r in select id from modules where login_code is null loop
    loop
      candidate := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      exit when not (candidate = any(used)) and not (candidate = any(reserved));
    end loop;
    used := used || candidate;
    update modules set login_code = candidate where id = r.id;
  end loop;
end $$;

create unique index if not exists branches_login_code_key on branches (login_code);
create unique index if not exists modules_login_code_key  on modules  (login_code);

alter table branches alter column login_code set not null;
alter table modules  alter column login_code set not null;

create or replace function resolve_login_code(code text)
returns table(type text, id text, name text, branch_name text)
language sql
security definer
stable
set search_path = public
as $fn$
  select 'branch'::text, b.id::text, b.name, null::text
  from branches b
  where b.login_code = lower(trim(code))
  union all
  select 'module'::text, m.id::text, m.name, br.name
  from modules m
  join branches br on br.id = m.branch_id
  where m.login_code = lower(trim(code))
  limit 1
$fn$;

revoke all on function resolve_login_code(text) from public;
grant execute on function resolve_login_code(text) to anon;
grant execute on function resolve_login_code(text) to authenticated;
