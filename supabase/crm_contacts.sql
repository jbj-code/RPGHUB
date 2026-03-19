-- Run this in Supabase → SQL Editor (entire file, or schema + then sample block).
-- Hub reads with anon key; email sync will use service_role (bypasses RLS).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  company text,
  job_title text,
  phone text,
  last_contact_at timestamptz,
  synced_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_contacts_email_unique
  on public.crm_contacts (lower(trim(email)));

create index if not exists crm_contacts_last_contact_idx
  on public.crm_contacts (last_contact_at desc nulls last);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_crm_contacts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_contacts_updated_at on public.crm_contacts;
create trigger crm_contacts_updated_at
  before update on public.crm_contacts
  for each row
  execute procedure public.set_crm_contacts_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: hub (anon) can read; writes only via service_role (sync script)
-- ---------------------------------------------------------------------------
alter table public.crm_contacts enable row level security;

drop policy if exists "crm_contacts_select_hub" on public.crm_contacts;
create policy "crm_contacts_select_hub"
  on public.crm_contacts
  for select
  to anon, authenticated
  using (true);

-- Optional: allow manual edits from dashboard with authenticated users later.
-- For now no insert/update/delete for anon.

-- ---------------------------------------------------------------------------
-- Sample rows (skips if that email already exists)
-- ---------------------------------------------------------------------------
insert into public.crm_contacts (email, full_name, company, job_title, phone, last_contact_at, synced_by_email)
select * from (values
  ('jane.smith@example.com'::text, 'Jane Smith'::text, 'Acme Capital'::text, 'Managing Director'::text, '(212) 555-0101'::text, now() - interval '2 days', 'you@resolutepg.com'::text),
  ('alex.rivera@example.org', 'Alex Rivera', 'Northbridge LP', 'VP Investor Relations', '(415) 555-0199', now() - interval '14 days', 'you@resolutepg.com'),
  ('sam.cho@example.net', 'Sam Cho', 'Harbor Family Office', 'CIO', null, now() - interval '45 days', 'you@resolutepg.com'),
  ('maria.garcia@example.com', 'Maria Garcia', 'Summit Endowment', 'Director of Alternatives', '(617) 555-0142', now() - interval '1 day', 'you@resolutepg.com'),
  ('demo.contact@resolutepg.com', 'Demo Contact', 'Resolute PG', 'Head of Platform', '(646) 555-0100', now() - interval '7 days', 'sample')
) as t(email, full_name, company, job_title, phone, last_contact_at, synced_by_email)
where not exists (
  select 1 from public.crm_contacts c where lower(trim(c.email)) = lower(trim(t.email))
);
