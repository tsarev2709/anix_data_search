alter table public.contact_search_companies
  add column if not exists source_lead_name text,
  add column if not exists source_company_id bigint,
  add column if not exists source_website text,
  add column if not exists company_context jsonb not null default '{}'::jsonb,
  add column if not exists research_trace jsonb not null default '{}'::jsonb,
  add column if not exists candidates jsonb not null default '[]'::jsonb,
  add column if not exists selected_candidates jsonb not null default '[]'::jsonb,
  add column if not exists actions jsonb not null default '[]'::jsonb;

create index if not exists contact_search_companies_source_lead_idx
  on public.contact_search_companies (source_lead_id, created_at desc);

alter table public.contact_search_runs
  add column if not exists metrics jsonb not null default '{}'::jsonb;
