-- Migration: Fix RLS infinite recursion & support onboarding flow
--
-- Problem: The original RLS policies on "profiles" use subqueries like:
--   company_id in (select company_id from profiles where id = auth.uid())
-- This is self-referential and causes Postgres to detect infinite recursion.
--
-- Solution: Create a security-definer helper function that reads the user's
-- company_id bypassing RLS, then use it in all policies that need company scoping.

-- 1. Helper function: returns the current user's company_id, bypassing RLS
create or replace function public.get_my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from profiles where id = auth.uid();
$$;

-- 2. Update the trigger to conditionally create profile
create or replace function public.handle_new_user()
returns trigger as $$
begin
  if new.raw_user_meta_data->>'company_id' is not null then
    insert into public.profiles (id, company_id, full_name, email, role)
    values (
      new.id,
      (new.raw_user_meta_data->>'company_id')::uuid,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      new.email,
      coalesce((new.raw_user_meta_data->>'role')::user_role, 'sdr')
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- 3. Drop ALL recursive policies (from migration 001) and re-create them non-recursively

-- Profiles policies
drop policy if exists "Users see company profiles" on profiles;
drop policy if exists "Admins and managers insert profiles" on profiles;

create policy "Users see company profiles" on profiles
  for select using (company_id = public.get_my_company_id());

create policy "Admins and managers insert profiles" on profiles
  for insert with check (
    company_id = public.get_my_company_id()
    and (select role from profiles where id = auth.uid()) in ('admin', 'manager')
  );

-- Companies policies
drop policy if exists "Users see own company" on companies;

create policy "Users see own company" on companies
  for select using (id = public.get_my_company_id());

-- Calls policies
drop policy if exists "Users see company calls" on calls;
drop policy if exists "Managers upload calls" on calls;

create policy "Users see company calls" on calls
  for select using (company_id = public.get_my_company_id());

create policy "Managers upload calls" on calls
  for insert with check (
    company_id = public.get_my_company_id()
    and (select role from profiles where id = auth.uid()) in ('admin', 'manager')
  );

-- Call analyses policies
drop policy if exists "Users see company analyses" on call_analyses;

create policy "Users see company analyses" on call_analyses
  for select using (call_id in (select id from calls where company_id = public.get_my_company_id()));

-- Coaching items policies
drop policy if exists "Users see company coaching" on coaching_items;
drop policy if exists "Users update own coaching items" on coaching_items;

create policy "Users see company coaching" on coaching_items
  for select using (company_id = public.get_my_company_id());

create policy "Users update own coaching items" on coaching_items
  for update using (company_id = public.get_my_company_id());

-- Weekly reports policies
drop policy if exists "Users see company reports" on weekly_reports;

create policy "Users see company reports" on weekly_reports
  for select using (company_id = public.get_my_company_id());

-- System insert policies (no change needed, kept for clarity)
-- "System inserts analyses" and "System inserts coaching" and "System inserts reports"
-- These use `with check (true)` and don't reference profiles, so no recursion risk.

-- 4. Drop the foreign key constraint on profiles.id -> auth.users
-- This allows "placeholder" profiles for SDRs who don't have auth accounts yet.
-- They can be invited later to get a login, at which point their profile
-- can be linked to their auth account.
alter table profiles drop constraint if exists profiles_id_fkey;

-- 5. Onboarding-specific policies (for users who don't have a profile yet)

-- Allow any authenticated user to create a company during onboarding
drop policy if exists "Authenticated users can create companies" on companies;
create policy "Authenticated users can create companies" on companies
  for insert with check (auth.uid() is not null);

-- Allow a user to create their own profile during onboarding
-- Also allows admins/managers to create placeholder profiles (Quick Add)
drop policy if exists "Users can create own profile" on profiles;
create policy "Users can create own profile" on profiles
  for insert with check (
    id = auth.uid()
    or (
      company_id = public.get_my_company_id()
      and (select role from profiles where id = auth.uid()) in ('admin', 'manager')
    )
  );

-- Allow a user to read their own profile (needed before company_id is set up)
drop policy if exists "Users can read own profile" on profiles;
create policy "Users can read own profile" on profiles
  for select using (id = auth.uid());

-- Allow users to update their own profile
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles
  for update using (id = auth.uid());

-- Allow admins/managers to update their company
drop policy if exists "Admins update company" on companies;
create policy "Admins update company" on companies
  for update using (id = public.get_my_company_id()
    and (select role from profiles where id = auth.uid()) in ('admin', 'manager'));
