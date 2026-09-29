create table if not exists public.voice_eval_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.va_users(id) on delete cascade,
  scenario_id text not null,
  scenario_version integer not null,
  caller_type text not null check (caller_type in ('human', 'synthetic')),
  agent_config_id uuid references public.va_agent_configs(id) on delete set null,
  config_fingerprint text not null,
  config_snapshot jsonb not null default '{}'::jsonb,
  session_id uuid references public.va_sessions(id) on delete set null,
  eval_run_id uuid not null unique,
  eval_patient text not null,
  setup jsonb not null default '{}'::jsonb,
  status text not null default 'running'
    check (status in ('running', 'scoring', 'pass', 'fail', 'invalid_harness', 'aborted')),
  gates jsonb,
  scores jsonb,
  latency jsonb,
  judge jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  scored_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists voice_eval_runs_owner_created_idx on public.voice_eval_runs (owner_id, created_at desc);
create index if not exists voice_eval_runs_status_started_idx on public.voice_eval_runs (status, started_at);

create table if not exists public.voice_eval_evidence (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.voice_eval_runs(id) on delete cascade,
  seq integer not null,
  at_ms integer not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

alter table public.voice_eval_runs enable row level security;
alter table public.voice_eval_evidence enable row level security;

create policy "voice eval runs owner read" on public.voice_eval_runs
  for select using (
    exists (select 1 from public.va_users u where u.id = owner_id and u.auth_user_id = auth.uid())
  );

create policy "voice eval evidence owner read" on public.voice_eval_evidence
  for select using (
    exists (
      select 1 from public.voice_eval_runs r join public.va_users u on u.id = r.owner_id
      where r.id = run_id and u.auth_user_id = auth.uid()
    )
  );

create policy "voice eval evidence owner insert while running" on public.voice_eval_evidence
  for insert with check (
    exists (
      select 1 from public.voice_eval_runs r join public.va_users u on u.id = r.owner_id
      where r.id = run_id and r.status = 'running' and u.auth_user_id = auth.uid()
    )
  );
