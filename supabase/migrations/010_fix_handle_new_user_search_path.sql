-- Migration: Fix search path and schema-qualify role cast for handle_new_user trigger function

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
      coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'sdr')
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
