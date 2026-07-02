-- Migration: Allow admins and managers to update company profiles

drop policy if exists "Admins and managers update profiles" on public.profiles;
create policy "Admins and managers update profiles" on public.profiles
  for update using (
    company_id = public.get_my_company_id()
    and (select role from public.profiles where id = auth.uid()) in ('admin', 'manager')
  );
