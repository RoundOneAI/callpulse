-- CallPulse Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Enum types
create type user_role as enum ('admin', 'manager', 'sdr');
create type call_status as enum ('uploading', 'transcribing', 'analyzing', 'completed', 'failed');
create type coaching_status as enum ('open', 'in_progress', 'completed');

-- Companies table
create table companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now()
);

-- Profiles table (extends auth.users)
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  company_id uuid references companies(id) on delete cascade not null,
  full_name text not null,
  email text not null,
  role user_role not null default 'sdr',
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Calls table
create table calls (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  sdr_id uuid references profiles(id) not null,
  uploaded_by uuid references profiles(id) not null,
  file_url text,
  transcript text,
  call_date date not null default current_date,
  week_number integer not null,
  year integer not null,
  duration_seconds integer,
  prospect_name text,
  status call_status not null default 'uploading',
  created_at timestamptz default now()
);

-- Call analyses table
create table call_analyses (
  id uuid primary key default uuid_generate_v4(),
  call_id uuid references calls(id) on delete cascade not null unique,
  overall_score numeric(3,1) not null,
  opening_score numeric(3,1) not null,
  opening_justification text not null,
  opening_quotes text[] default '{}',
  discovery_score numeric(3,1) not null,
  discovery_justification text not null,
  discovery_quotes text[] default '{}',
  value_prop_score numeric(3,1) not null,
  value_prop_justification text not null,
  value_prop_quotes text[] default '{}',
  objection_score numeric(3,1) not null,
  objection_justification text not null,
  objection_quotes text[] default '{}',
  closing_score numeric(3,1) not null,
  closing_justification text not null,
  closing_quotes text[] default '{}',
  tone_score numeric(3,1) not null,
  tone_justification text not null,
  tone_quotes text[] default '{}',
  strengths text[] default '{}',
  weaknesses text[] default '{}',
  summary text not null,
  created_at timestamptz default now()
);

-- Coaching items table
create table coaching_items (
  id uuid primary key default uuid_generate_v4(),
  call_analysis_id uuid references call_analyses(id) on delete cascade not null,
  sdr_id uuid references profiles(id) not null,
  company_id uuid references companies(id) on delete cascade not null,
  dimension text not null,
  action_item text not null,
  status coaching_status not null default 'open',
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Weekly reports table
create table weekly_reports (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete cascade not null,
  sdr_id uuid references profiles(id) not null,
  week_number integer not null,
  year integer not null,
  calls_analyzed integer not null default 0,
  avg_scores jsonb not null default '{}',
  best_call_id uuid references calls(id),
  worst_call_id uuid references calls(id),
  summary text,
  comparison_with_previous jsonb default '{}',
  coaching_impact jsonb default '{}',
  created_at timestamptz default now(),
  unique(sdr_id, week_number, year)
);

-- Indexes
create index idx_calls_company on calls(company_id);
create index idx_calls_sdr on calls(sdr_id);
create index idx_calls_week on calls(year, week_number);
create index idx_calls_status on calls(status);
create index idx_analyses_call on call_analyses(call_id);
create index idx_coaching_sdr on coaching_items(sdr_id);
create index idx_coaching_status on coaching_items(status);
create index idx_weekly_reports_sdr_week on weekly_reports(sdr_id, year, week_number);
create index idx_profiles_company on profiles(company_id);

-- Row Level Security
alter table companies enable row level security;
alter table profiles enable row level security;
alter table calls enable row level security;
alter table call_analyses enable row level security;
alter table coaching_items enable row level security;
alter table weekly_reports enable row level security;

-- RLS Policies: Users can only see data from their own company
create policy "Users see own company" on companies
  for select using (id in (select company_id from profiles where id = auth.uid()));

create policy "Users see company profiles" on profiles
  for select using (company_id in (select company_id from profiles where id = auth.uid()));

create policy "Admins and managers insert profiles" on profiles
  for insert with check (
    company_id in (
      select company_id from profiles
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

create policy "Users see company calls" on calls
  for select using (company_id in (select company_id from profiles where id = auth.uid()));

create policy "Managers upload calls" on calls
  for insert with check (
    company_id in (
      select company_id from profiles
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

create policy "Users see company analyses" on call_analyses
  for select using (
    call_id in (
      select c.id from calls c
      join profiles p on p.company_id = c.company_id
      where p.id = auth.uid()
    )
  );

create policy "System inserts analyses" on call_analyses
  for insert with check (true);

create policy "Users see company coaching" on coaching_items
  for select using (company_id in (select company_id from profiles where id = auth.uid()));

create policy "System inserts coaching" on coaching_items
  for insert with check (true);

create policy "Users update own coaching" on coaching_items
  for update using (
    sdr_id = auth.uid()
    or company_id in (
      select company_id from profiles
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

create policy "Users see company reports" on weekly_reports
  for select using (company_id in (select company_id from profiles where id = auth.uid()));

create policy "System inserts reports" on weekly_reports
  for insert with check (true);

-- Function to auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, company_id, full_name, email, role)
  values (
    new.id,
    (new.raw_user_meta_data->>'company_id')::uuid,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'sdr')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage bucket for audio files
insert into storage.buckets (id, name, public) values ('call-recordings', 'call-recordings', false);

create policy "Users upload to own company bucket" on storage.objects
  for insert with check (
    bucket_id = 'call-recordings'
    and auth.uid() is not null
  );

create policy "Users read own company files" on storage.objects
  for select using (
    bucket_id = 'call-recordings'
    and auth.uid() is not null
  );
