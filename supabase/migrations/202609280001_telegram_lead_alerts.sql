alter table public.demand_signals
  add column if not exists reply_draft text,
  add column if not exists contact_url text,
  add column if not exists alert_status text not null default 'not_required',
  add column if not exists alert_attempted_at timestamptz,
  add column if not exists alert_sent_at timestamptz,
  add column if not exists alert_error text;

alter table public.demand_signals
  add constraint demand_signals_alert_status_check
  check (alert_status in ('not_required', 'pending', 'sending', 'sent', 'failed'));

create index if not exists demand_signals_alert_idx
  on public.demand_signals (alert_status, last_seen_at desc);
