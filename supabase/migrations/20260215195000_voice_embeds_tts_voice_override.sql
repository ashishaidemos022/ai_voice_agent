-- Voice embeds: treat va_voice_embeds.tts_voice as an optional OpenAI-only override.
-- For non-OpenAI providers, the embed should always follow the agent config voice_id.
-- For OpenAI providers, NULL means "follow agent preset voice", non-NULL means "override".

-- 1) Clear any stored OpenAI voice values for non-OpenAI providers.
update public.va_voice_embeds ve
set tts_voice = null
from public.va_agent_configs ac
where ac.id = ve.agent_config_id
  and (ac.voice_provider is not null and ac.voice_provider <> 'openai_realtime')
  and ve.tts_voice is not null;

-- 2) For OpenAI providers, clear redundant overrides that match the agent preset voice.
-- This allows future agent voice changes to automatically reflect on embeds.
update public.va_voice_embeds ve
set tts_voice = null
from public.va_agent_configs ac
where ac.id = ve.agent_config_id
  and (ac.voice_provider is null or ac.voice_provider = 'openai_realtime')
  and ve.tts_voice is not null
  and ve.tts_voice = ac.voice;

