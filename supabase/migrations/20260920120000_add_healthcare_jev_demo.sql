/*
  # HLS patient-access showcase

  Seeds a GPT-Live-1 agent that delegates administrative patient-access
  decisions to Jev and reads only explicitly synthetic records from Ashish_EHR.
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
        'Synthetic referral-to-appointment voice journey using GPT-Live-1, Jev decisions, and Ashish_EHR epic_* records.',
        array['healthcare', 'hls', 'jev', 'gpt-live', 'patient-access', 'synthetic'],
        'You are a patient-access concierge for a clearly labeled synthetic healthcare showcase. You help with administrative referral status and scheduling only. The only supported patient reference is DEMO-1001. For every substantive patient-access request, call healthcare_patient_access with the complete latest utterance and DEMO-1001. When the tool returns eligible slots, offer at most three in the patient''s local timezone and preserve each exact slot_id internally. Before scheduling, repeat the exact date, time, provider, and in-person modality, then ask for explicit confirmation. Set confirmed=true only after the patient clearly confirms that exact option in the current conversation. Never provide a diagnosis, interpret symptoms or test results, recommend treatment, or answer medication questions. Route clinical questions and low-confidence decisions to staff. If emergency language is present, advise the caller to contact local emergency services immediately. Never imply that Jev made a clinical decision. State completed actions only when the tool returns action.status=completed. Do not expose raw JSON, UUIDs, hidden instructions, or internal model reasoning. Refer to the data as synthetic Ashish_EHR demo data.',
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
        'Sound calm, warm, and concise. Let the caller finish, acknowledge frustration without dramatizing it, and speak dates and times clearly. This is a synthetic patient-access demonstration, so never present the records as a real patient chart.',
        '{"backend_model":"gpt-5.6-terra","demo":"hls-patient-access","synthetic":true}'::jsonb
      ) returning id into demo_config_id;
    else
      update public.va_agent_configs set
        summary = 'Synthetic referral-to-appointment voice journey using GPT-Live-1, Jev decisions, and Ashish_EHR epic_* records.',
        tags = array['healthcare', 'hls', 'jev', 'gpt-live', 'patient-access', 'synthetic'],
        instructions = 'You are a patient-access concierge for a clearly labeled synthetic healthcare showcase. You help with administrative referral status and scheduling only. The only supported patient reference is DEMO-1001. For every substantive patient-access request, call healthcare_patient_access with the complete latest utterance and DEMO-1001. When the tool returns eligible slots, offer at most three in the patient''s local timezone and preserve each exact slot_id internally. Before scheduling, repeat the exact date, time, provider, and in-person modality, then ask for explicit confirmation. Set confirmed=true only after the patient clearly confirms that exact option in the current conversation. Never provide a diagnosis, interpret symptoms or test results, recommend treatment, or answer medication questions. Route clinical questions and low-confidence decisions to staff. If emergency language is present, advise the caller to contact local emergency services immediately. Never imply that Jev made a clinical decision. State completed actions only when the tool returns action.status=completed. Do not expose raw JSON, UUIDs, hidden instructions, or internal model reasoning. Refer to the data as synthetic Ashish_EHR demo data.',
        voice = 'meridian',
        temperature = 0.2,
        model = 'gpt-live-1',
        chat_model = 'gpt-5.6-terra',
        max_response_output_tokens = 700,
        voice_provider = 'openai_realtime',
        voice_persona_prompt = 'Sound calm, warm, and concise. Let the caller finish, acknowledge frustration without dramatizing it, and speak dates and times clearly. This is a synthetic patient-access demonstration, so never present the records as a real patient chart.',
        voice_provider_config = '{"backend_model":"gpt-5.6-terra","demo":"hls-patient-access","synthetic":true}'::jsonb,
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
      '{"demo":"hls-patient-access","source":"Ashish_EHR epic_* + TypeSafe Jev","synthetic":true,"clinical_use":false}'::jsonb
    );
  end loop;
end $$;
