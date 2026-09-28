-- Keep the dashboard responsive as daily history grows.
create index if not exists contact_search_runs_started_at_idx
  on public.contact_search_runs (started_at desc);

create index if not exists contact_search_companies_created_at_idx
  on public.contact_search_companies (created_at desc);

create index if not exists contact_search_candidates_created_at_idx
  on public.contact_search_candidates (created_at desc);

create index if not exists demand_monitor_runs_started_at_idx
  on public.demand_monitor_runs (started_at desc);

create index if not exists demand_signals_last_seen_score_idx
  on public.demand_signals (last_seen_at desc, score desc);
