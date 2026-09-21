/* Keep the JEV-backed patient-access tool and current-time MCP tool enabled together. */

update public.va_agent_configs
set
  instructions = replace(
    instructions,
    'Use healthcare_patient_access on every substantive patient-access turn. Pass the caller''s complete latest statement, patient_reference DEMO-1001, and exactly one action: verify_patient, lookup_appointments, lookup_referrals, search_availability, book_appointment, reschedule_appointment, cancel_appointment, visit_logistics, or request_staff. The tool runs the EHR workflow and Jev decision support; follow its applied next_step.',
    'Use healthcare_patient_access on every substantive patient-access turn. Pass the caller''s complete latest statement, patient_reference DEMO-1001, and exactly one action: verify_patient, lookup_appointments, lookup_referrals, search_availability, book_appointment, reschedule_appointment, cancel_appointment, visit_logistics, or request_staff. The tool runs the EHR workflow and Jev decision support; follow its applied next_step.

Time grounding:
- At the first substantive request in each call, invoke get_current_time before the patient-access tool. Keep the returned current time and timezone for the conversation.
- Invoke get_current_time again whenever the caller uses a relative expression such as today, tomorrow, this afternoon, next week, or a weekday without a date, or when the call crosses midnight.
- Interpret and speak all EHR slot times in the timezone returned by get_current_time. Never infer the current date or timezone from model memory.
- Do not offer a slot in the past. Preserve the exact EHR timestamp and slot_id internally even when speaking a friendly local date and time.'
  ),
  updated_at = now()
where name = 'HLS Patient Access · Jev + GPT-Live'
  and instructions not like '%At the first substantive request in each call, invoke get_current_time%';

insert into public.va_agent_config_tools (
  id, config_id, user_id, tool_name, tool_source, metadata
)
select
  gen_random_uuid(),
  config.id,
  config.user_id,
  'healthcare_patient_access',
  'client',
  '{"workflow":"identity-gated patient access","source":"Supabase_EHR + TypeSafe Jev","jev_every_turn":true}'::jsonb
from public.va_agent_configs config
where config.name = 'HLS Patient Access · Jev + GPT-Live'
  and not exists (
    select 1 from public.va_agent_config_tools selected
    where selected.config_id = config.id
      and selected.tool_name = 'healthcare_patient_access'
  );

insert into public.va_agent_config_tools (
  id, config_id, user_id, tool_id, tool_name, tool_source, connection_id, metadata
)
select
  gen_random_uuid(),
  config.id,
  config.user_id,
  tool.id,
  tool.tool_name,
  'mcp',
  tool.connection_id,
  '{"purpose":"authoritative current date, time, and timezone for patient scheduling"}'::jsonb
from public.va_agent_configs config
join public.va_mcp_tools tool on tool.user_id = config.user_id
join public.va_mcp_connections connection on connection.id = tool.connection_id
where config.name = 'HLS Patient Access · Jev + GPT-Live'
  and tool.tool_name = 'get_current_time'
  and tool.is_enabled = true
  and connection.is_enabled = true
  and connection.status = 'active'
  and not exists (
    select 1 from public.va_agent_config_tools selected
    where selected.config_id = config.id
      and selected.tool_name = 'get_current_time'
      and selected.connection_id = tool.connection_id
  );
