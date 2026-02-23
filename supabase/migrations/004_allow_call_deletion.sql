-- Fix weekly_reports FK so deleting a call sets references to NULL instead of blocking
alter table weekly_reports
  drop constraint if exists weekly_reports_best_call_id_fkey,
  drop constraint if exists weekly_reports_worst_call_id_fkey;

alter table weekly_reports
  add constraint weekly_reports_best_call_id_fkey
    foreign key (best_call_id) references calls(id) on delete set null,
  add constraint weekly_reports_worst_call_id_fkey
    foreign key (worst_call_id) references calls(id) on delete set null;
