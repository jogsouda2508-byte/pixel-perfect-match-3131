-- =====================================================================
-- Reports: add a "child_safety" reason.
--
-- Why: the in-app Report menu now has "Child safety concern" (see src/lib/safety.ts and the
-- /child-safety page). The reports.reason check from 20261111000000_block_mute_report.sql only
-- allowed the older reasons, so a child safety report would be rejected without this.
--
-- Additive and safe to run more than once. Existing reports are not changed.
-- =====================================================================
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports
  add constraint reports_reason_check check (reason in
    ('spam', 'harassment', 'hate', 'nudity', 'child_safety', 'violence', 'scam', 'false_info', 'self_harm', 'other'));

-- Lets the admin review queue pull child safety reports first.
create index if not exists reports_child_safety_idx
  on public.reports (created_at desc) where reason = 'child_safety' and status = 'open';
