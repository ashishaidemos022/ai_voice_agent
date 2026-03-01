-- Fix enforce_voice_embed_owner trigger: do not auto-populate va_voice_embeds.tts_voice.
-- tts_voice is an OpenAI-only optional override; NULL means "follow agent preset voice".

create or replace function public.enforce_voice_embed_owner()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  cfg_user uuid;
begin
  select user_id into cfg_user
  from public.va_agent_configs
  where id = new.agent_config_id;

  if cfg_user is null then
    raise exception 'Agent config % not found for voice embed', new.agent_config_id;
  end if;

  new.user_id := cfg_user;
  new.updated_at := timezone('utc', now());
  return new;
end;
$function$;

-- Cleanup: remove any tts_voice values on non-OpenAI providers.
update public.va_voice_embeds ve
set tts_voice = null
from public.va_agent_configs ac
where ac.id = ve.agent_config_id
  and ac.voice_provider in ('elevenlabs_tts', 'personaplex')
  and ve.tts_voice is not null;

-- Cleanup: remove redundant OpenAI overrides equal to preset voice.
update public.va_voice_embeds ve
set tts_voice = null
from public.va_agent_configs ac
where ac.id = ve.agent_config_id
  and (ac.voice_provider is null or ac.voice_provider = 'openai_realtime')
  and ve.tts_voice is not null
  and ve.tts_voice = ac.voice;

