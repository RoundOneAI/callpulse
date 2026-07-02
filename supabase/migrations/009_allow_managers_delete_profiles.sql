-- Migration: Allow admins and managers to delete profiles

drop policy if exists "Admins and managers delete profiles" on public.profiles;
create policy "Admins and managers delete profiles" on public.profiles
  for delete using (
    company_id = public.get_my_company_id()
    and (select role from public.profiles where id = auth.uid()) in ('admin', 'manager')
  );
