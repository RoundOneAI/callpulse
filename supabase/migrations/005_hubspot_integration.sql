-- Migration: Add HubSpot Integration Support

-- 1. Create integrations table
create table if not exists public.integrations (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references public.companies(id) on delete cascade not null,
  type text not null, -- 'hubspot'
  credentials jsonb not null default '{}'::jsonb, -- e.g., { "private_token": "..." }
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, type)
);

-- 2. Add hubspot_call_id column to calls table to prevent duplicates
alter table public.calls add column if not exists hubspot_call_id text;
create index if not exists idx_calls_hubspot_call_id on public.calls(hubspot_call_id);

-- Add unique constraint on company_id and hubspot_call_id
alter table public.calls drop constraint if exists calls_hubspot_call_id_unique;
alter table public.calls add constraint calls_hubspot_call_id_unique unique (company_id, hubspot_call_id);

-- 3. Enable RLS on integrations
alter table public.integrations enable row level security;

-- 4. RLS policies for integrations
drop policy if exists "Users see company integrations" on public.integrations;
create policy "Users see company integrations" on public.integrations
  for select using (company_id = public.get_my_company_id());

drop policy if exists "Admins and managers modify integrations" on public.integrations;
create policy "Admins and managers modify integrations" on public.integrations
  for all using (
    company_id = public.get_my_company_id()
    and (select role from public.profiles where id = auth.uid()) in ('admin', 'manager')
  );
