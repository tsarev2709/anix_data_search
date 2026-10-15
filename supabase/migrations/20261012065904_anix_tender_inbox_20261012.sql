-- Private intake for public procurement notices. The scheduled agent writes
-- candidates here; the existing amoCRM sync processes them with server-side OAuth.
create table if not exists public.tender_inbox (
  source_key text primary key check (length(source_key) between 5 and 180),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processed', 'expired', 'error')),
  attempts integer not null default 0 check (attempts >= 0),
  amo_lead_id bigint,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.tender_inbox enable row level security;
revoke all on public.tender_inbox from anon, authenticated;
create index if not exists tender_inbox_pending_idx
  on public.tender_inbox (created_at)
  where status in ('pending', 'error') and attempts < 3;

