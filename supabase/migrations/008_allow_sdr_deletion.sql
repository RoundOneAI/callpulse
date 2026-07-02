-- Migration: Allow SDR profiles to be deleted by cascading sdr_id constraints

alter table public.calls
  drop constraint if exists calls_sdr_id_fkey,
  add constraint calls_sdr_id_fkey
    foreign key (sdr_id) references public.profiles(id) on delete cascade;

alter table public.coaching_items
  drop constraint if exists coaching_items_sdr_id_fkey,
  add constraint coaching_items_sdr_id_fkey
    foreign key (sdr_id) references public.profiles(id) on delete cascade;

alter table public.weekly_reports
  drop constraint if exists weekly_reports_sdr_id_fkey,
  add constraint weekly_reports_sdr_id_fkey
    foreign key (sdr_id) references public.profiles(id) on delete cascade;
