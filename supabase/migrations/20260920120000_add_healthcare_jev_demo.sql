/*
  # HLS patient-access showcase

  Seeds a GPT-Live-1 agent that delegates administrative patient-access
  decisions to Jev and reads the configured Ashish_EHR records.
*/

do $$
declare
  demo_user record;
  demo_config_id uuid;
begin
  for demo_user in select id from public.va_users loop
    select id into demo_config_id
    from public.va_agent_configs
    where user_id = demo_user.id
      and name = 'HLS Patient Access · Jev + GPT-Live'
    order by created_at desc
    limit 1;

    if demo_config_id is null then
      insert into public.va_agent_configs (
        user_id, name, summary, tags, instructions, voice, temperature, model,
        chat_model, max_response_output_tokens, turn_detection_enabled,
        turn_detection_config, is_default, rag_enabled, rag_mode,
        voice_provider, voice_persona_prompt, voice_provider_config
      ) values (
        demo_user.id,
        'HLS Patient Access · Jev + GPT-Live',
        'Referral-to-appointment voice journey using GPT-Live-1, Jev decisions, and Ashish_EHR epic_* records.',
        array['healthcare', 'hls', 'jev', 'gpt-live', 'patient-access'],
        'You are the HLS patient-access concierge. Help with administrative referral status and scheduling. Use patient reference DEMO-1001 internally and call healthcare_patient_access for every substantive request. Do not expose raw identifiers or internal systems.',
        'meridian',
        0.2,
        'gpt-live-1',
        'gpt-5.6-terra',
        700,
        true,
        '{"type":"server_vad","threshold":0.65,"prefix_padding_ms":200,"silence_duration_ms":650}'::jsonb,
        false,
        false,
        'guardrail',
        'openai_realtime',
        'Sound calm, warm, and concise. Let the caller finish and speak dates and times clearly.',
        '{"backend_model":"gpt-5.6-terra","workflow":"hls-patient-access"}'::jsonb
      ) returning id into demo_config_id;
    else
      update public.va_agent_configs set
        summary = 'Referral-to-appointment voice journey using GPT-Live-1, Jev decisions, and Ashish_EHR epic_* records.',
        tags = array['healthcare', 'hls', 'jev', 'gpt-live', 'patient-access'],
        instructions = 'You are the HLS patient-access concierge. Help with administrative referral status and scheduling. Use patient reference DEMO-1001 internally and call healthcare_patient_access for every substantive request. Do not expose raw identifiers or internal systems.',
        voice = 'meridian',
        temperature = 0.2,
        model = 'gpt-live-1',
        chat_model = 'gpt-5.6-terra',
        max_response_output_tokens = 700,
        voice_provider = 'openai_realtime',
        voice_persona_prompt = 'Sound calm, warm, and concise. Let the caller finish and speak dates and times clearly.',
        voice_provider_config = '{"backend_model":"gpt-5.6-terra","workflow":"hls-patient-access"}'::jsonb,
        updated_at = now()
      where id = demo_config_id;
    end if;

    delete from public.va_agent_config_tools
    where config_id = demo_config_id
      and tool_name in ('__none__', 'healthcare_patient_access');

    insert into public.va_agent_config_tools (
      config_id, user_id, tool_name, tool_source, metadata
    ) values (
      demo_config_id,
      demo_user.id,
      'healthcare_patient_access',
      'client',
      '{"workflow":"hls-patient-access","source":"Ashish_EHR epic_* + TypeSafe Jev"}'::jsonb
    );
  end loop;
end $$;
