-- Separate actionable sales opportunities from market noise.
alter table public.demand_signals
  add column if not exists signal_type text not null default 'market_intelligence',
  add column if not exists lead_gate_passed boolean not null default false,
  add column if not exists evidence_quote text not null default '',
  add column if not exists contactability text not null default 'none',
  add column if not exists next_action text not null default '';

do $$ begin
  alter table public.demand_signals
    add constraint demand_signals_signal_type_check
    check (signal_type in ('direct_demand', 'account_trigger', 'market_intelligence'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.demand_signals
    add constraint demand_signals_contactability_check
    check (contactability in ('direct', 'source_reply', 'company_research', 'none'));
exception when duplicate_object then null;
end $$;

-- Existing web rows were created by the old query-inheritance scorer. Keep them
-- for audit, but remove them from the actionable sales queue until rediscovered.
update public.demand_signals
set signal_type = 'market_intelligence',
    lead_gate_passed = false,
    evidence_quote = case when evidence_quote = '' then left(coalesce(snippet, title), 500) else evidence_quote end,
    next_action = case when next_action = '' then 'Не передавать в продажи; использовать только как рыночный контекст' else next_action end
where source <> 'telegram_ninja';

-- Previously accepted Telegram messages already passed a stricter request filter.
update public.demand_signals
set signal_type = 'direct_demand',
    lead_gate_passed = true,
    evidence_quote = case when evidence_quote = '' then left(coalesce(snippet, title), 500) else evidence_quote end,
    contactability = case
      when jsonb_array_length(emails) > 0 or jsonb_array_length(phones) > 0 then 'direct'
      when contact_url is not null or jsonb_array_length(social_urls) > 0 then 'source_reply'
      else 'company_research'
    end,
    next_action = case when next_action = '' then 'Ответить автору сегодня, сославшись на конкретную задачу' else next_action end
where source = 'telegram_ninja' and score >= 70;

create index if not exists demand_signals_sales_queue_idx
  on public.demand_signals (status, lead_gate_passed desc, signal_type, score desc, last_seen_at desc);

create index if not exists demand_signals_direct_new_idx
  on public.demand_signals (score desc, last_seen_at desc)
  where status = 'new' and lead_gate_passed = true;
