/* Run only in the Ashish_EHR project for the patient-access showcase. */

insert into public.epic_patients (
  id, mrn, first_name, last_name, email, preferred_language, mychart_active,
  coverage_summary, created_at
) values (
  '99999999-0000-0000-0000-000000000001',
  'DEMO-1001',
  'Amelia',
  'Hart',
  'amelia.hart@patient-access.example',
  'English',
  true,
  '{"plan":"HLS Health Plan"}'::jsonb,
  now()
)
on conflict (id) do update set
  mrn = excluded.mrn,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  coverage_summary = excluded.coverage_summary;

insert into public.epic_referrals (
  id, patient_id, kind, target_specialty, target_provider_id,
  requesting_provider_id, urgency, status, ordered_at, notes, created_at
) values (
  '99999999-0000-0000-0000-000000000101',
  '99999999-0000-0000-0000-000000000001',
  'referral',
  'Cardiology consult',
  '33333333-0000-0000-0000-000000000002',
  '33333333-0000-0000-0000-000000000001',
  'routine',
  'open',
  '2026-09-18 15:00:00+00',
  'Patient-access showcase referral.',
  now()
)
on conflict (id) do update set
  status = 'open',
  scheduled_at = null,
  notes = excluded.notes;

insert into public.epic_provider_schedule_slots (
  id, provider_id, department_id, slot_start, slot_end, duration_min,
  status, held_by_session_id, held_until, appointment_id,
  visit_types_allowed, created_at, updated_at
)
values
  ('99999999-0000-0000-0000-000000000201', '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000003', '2026-09-22 19:00:00+00', '2026-09-22 19:45:00+00', 45, 'open', null, null, null, array['CARDIOLOGY_CONSULT'], now(), now()),
  ('99999999-0000-0000-0000-000000000202', '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000003', '2026-09-23 20:30:00+00', '2026-09-23 21:15:00+00', 45, 'open', null, null, null, array['CARDIOLOGY_CONSULT'], now(), now()),
  ('99999999-0000-0000-0000-000000000203', '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000003', '2026-09-24 18:00:00+00', '2026-09-24 18:45:00+00', 45, 'open', null, null, null, array['CARDIOLOGY_CONSULT'], now(), now()),
  ('99999999-0000-0000-0000-000000000204', '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000003', '2026-09-25 21:00:00+00', '2026-09-25 21:45:00+00', 45, 'open', null, null, null, array['CARDIOLOGY_CONSULT'], now(), now()),
  ('99999999-0000-0000-0000-000000000205', '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000003', '2026-09-28 19:30:00+00', '2026-09-28 20:15:00+00', 45, 'open', null, null, null, array['CARDIOLOGY_CONSULT'], now(), now())
on conflict (id) do update set
  slot_start = excluded.slot_start,
  slot_end = excluded.slot_end,
  duration_min = excluded.duration_min,
  status = case
    when public.epic_provider_schedule_slots.appointment_id is null then 'open'
    else public.epic_provider_schedule_slots.status
  end,
  visit_types_allowed = excluded.visit_types_allowed,
  updated_at = now();
