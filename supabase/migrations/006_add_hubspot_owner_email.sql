-- Migration: Add hubspot_owner_email column to profiles

alter table public.profiles add column if not exists hubspot_owner_email text;
create index if not exists idx_profiles_hubspot_owner_email on public.profiles(hubspot_owner_email);
