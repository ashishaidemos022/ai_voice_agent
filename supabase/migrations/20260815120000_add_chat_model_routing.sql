/*
  # Per-turn chat model routing

  Stores the explainable routing decision and the complete cost/latency receipt for
  fixed and automatic chat turns. Tool continuations accumulate into the same turn.
*/

create table if not exists public.va_model_routing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.va_users(id) on delete cascade,
  session_id uuid references public.va_chat_sessions(id) on delete cascade,
  agent_config_id uuid not null references public.va_agent_configs(id) on delete cascade,
  turn_id uuid not null unique,
  strategy text not null check (strategy in ('auto', 'fixed')),
  selected_model text not null,
  task_type text not null,
  reasoning_effort text not null,
  reason_code text not null,
  reason text not null,
  confidence numeric not null default 1,
  complexity numeric not null default 0,
  requires_tools boolean not null default false,
  consequential boolean not null default false,
  policy_version text not null,
  router_model text,
  router_latency_ms integer not null default 0,
  router_cost_usd numeric(12, 8) not null default 0,
  answer_latency_ms integer not null default 0,
  answer_cost_usd numeric(12, 8) not null default 0,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  response_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_va_model_routing_session
  on public.va_model_routing_events(session_id, created_at);
create index if not exists idx_va_model_routing_user
  on public.va_model_routing_events(user_id, created_at desc);

alter table public.va_model_routing_events enable row level security;

create policy "Users read their model routing events"
  on public.va_model_routing_events
  for select
  to authenticated
  using (user_id = public.current_va_user_id());

grant select on public.va_model_routing_events to authenticated;
