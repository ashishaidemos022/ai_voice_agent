-- Personal facts/episodes are customer scoped; procedures are agent scoped.
create table public.va_memory_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.va_users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.va_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.va_users(id) on delete cascade,
  agent_id uuid not null references public.va_agent_configs(id) on delete cascade,
  subject_id uuid,
  kind text not null check (kind in ('semantic','episodic','procedural')),
  memory_key text not null check (length(memory_key) between 1 and 120),
  title text not null check (length(title) between 1 and 160),
  content text not null check (length(content) between 1 and 6000),
  source_quote text not null default '',
  source_message_id uuid references public.va_chat_messages(id) on delete set null,
  source_session_id uuid references public.va_chat_sessions(id) on delete set null,
  source text not null check (source in ('user','owner','consolidation')),
  happened_at timestamptz,
  status text not null default 'active' check (status in ('active','forgotten')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.va_memory_subjects(id, user_id) on delete cascade,
  check ((kind = 'procedural' and subject_id is null) or (kind <> 'procedural' and subject_id is not null))
);
create unique index va_memory_customer_key on public.va_memories(user_id, agent_id, subject_id, kind, memory_key) where subject_id is not null;
create unique index va_memory_playbook_key on public.va_memories(user_id, agent_id, kind, memory_key) where subject_id is null;
create index va_memory_lookup on public.va_memories(user_id, agent_id, subject_id, status);

create table public.va_memory_versions (
  id bigint generated always as identity primary key,
  memory_id uuid not null references public.va_memories(id) on delete cascade,
  user_id uuid not null references public.va_users(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(memory_id, version)
);

create table public.va_memory_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.va_users(id) on delete cascade,
  agent_id uuid not null references public.va_agent_configs(id) on delete cascade,
  subject_id uuid not null,
  session_id uuid not null references public.va_chat_sessions(id) on delete cascade,
  turn_id uuid not null,
  event_key text not null,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.va_memory_subjects(id, user_id) on delete cascade,
  unique(session_id, event_key)
);
create index va_memory_events_session on public.va_memory_events(session_id, created_at);

-- Clients can inspect their own records. All writes go through authenticated
-- Edge Functions so the caller cannot forge source links, versions or events.
alter table public.va_memory_subjects enable row level security;
alter table public.va_memories enable row level security;
alter table public.va_memory_versions enable row level security;
alter table public.va_memory_events enable row level security;
create policy memory_subject_read on public.va_memory_subjects for select to authenticated using (user_id = public.current_va_user_id());
create policy memory_record_read on public.va_memories for select to authenticated using (user_id = public.current_va_user_id());
create policy memory_version_read on public.va_memory_versions for select to authenticated using (user_id = public.current_va_user_id());
create policy memory_event_read on public.va_memory_events for select to authenticated using (user_id = public.current_va_user_id());
grant select on public.va_memory_subjects, public.va_memories, public.va_memory_versions, public.va_memory_events to authenticated;
revoke insert, update, delete on public.va_memory_subjects, public.va_memories, public.va_memory_versions, public.va_memory_events from anon, authenticated;

-- A single transaction serializes writes for a logical memory and snapshots
-- every version. expected_version prevents an editor overwriting a newer fact.
create function public.va_write_memory(p_user uuid, p_agent uuid, p_subject uuid, p_record jsonb, p_expected_version integer default null)
returns public.va_memories language plpgsql security invoker set search_path = public as $$
declare old public.va_memories; saved public.va_memories; k text := p_record->>'memory_key';
begin
  if not exists(select 1 from va_agent_configs where id=p_agent and user_id=p_user) then raise exception 'Agent not found'; end if;
  if p_subject is not null and not exists(select 1 from va_memory_subjects where id=p_subject and user_id=p_user) then raise exception 'Profile not found'; end if;
  if nullif(p_record->>'source_session_id','') is not null and not exists(
    select 1 from va_chat_sessions where id=(p_record->>'source_session_id')::uuid and user_id=p_user and agent_preset_id=p_agent
  ) then raise exception 'Invalid source session'; end if;
  if nullif(p_record->>'source_message_id','') is not null and not exists(
    select 1 from va_chat_messages where id=(p_record->>'source_message_id')::uuid and user_id=p_user and session_id=(p_record->>'source_session_id')::uuid
  ) then raise exception 'Invalid source message'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_agent::text || coalesce(p_subject::text,'agent') || (p_record->>'kind') || k, 0));
  select * into old from va_memories where user_id=p_user and agent_id=p_agent and subject_id is not distinct from p_subject and kind=p_record->>'kind' and memory_key=k for update;
  if p_expected_version is not null and coalesce(old.version,0) <> p_expected_version then raise exception 'Memory changed. Refresh before editing.'; end if;
  if old.id is not null and old.content=p_record->>'content' and old.title=p_record->>'title' and old.status=coalesce(p_record->>'status','active') and old.source_quote=coalesce(p_record->>'source_quote','') then return old; end if;
  if old.id is not null then
    update va_memories set title=p_record->>'title', content=p_record->>'content', source_quote=coalesce(p_record->>'source_quote',''),
      source=p_record->>'source', source_message_id=nullif(p_record->>'source_message_id','')::uuid,
      source_session_id=nullif(p_record->>'source_session_id','')::uuid, happened_at=nullif(p_record->>'happened_at','')::timestamptz,
      status=coalesce(p_record->>'status','active'), version=old.version+1, updated_at=now()
      where id=old.id returning * into saved;
  else
    insert into va_memories(user_id,agent_id,subject_id,kind,memory_key,title,content,source_quote,source,source_message_id,source_session_id,happened_at,status)
    values(p_user,p_agent,p_subject,p_record->>'kind',k,p_record->>'title',p_record->>'content',coalesce(p_record->>'source_quote',''),p_record->>'source',
      nullif(p_record->>'source_message_id','')::uuid,nullif(p_record->>'source_session_id','')::uuid,nullif(p_record->>'happened_at','')::timestamptz,coalesce(p_record->>'status','active')) returning * into saved;
  end if;
  insert into va_memory_versions(memory_id,user_id,version,snapshot) values(saved.id,p_user,saved.version,to_jsonb(saved));
  return saved;
end $$;
revoke all on function public.va_write_memory(uuid,uuid,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.va_write_memory(uuid,uuid,uuid,jsonb,integer) to service_role;
