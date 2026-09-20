/* Patient-access call fixture for the HLS voice workflow. */

update public.epic_patients
set
  dob = '1988-04-12',
  phone_mobile = '+1-214-555-0188',
  address_line1 = '4100 Oak Lawn Ave',
  city = 'Dallas',
  state = 'TX',
  postal_code = '75219'
where id = '99999999-0000-0000-0000-000000000001';

insert into public.epic_appointments (
  id, patient_id, provider_id, department_id, start_at, duration_min, status,
  visit_type, visit_type_code, reason, confirmation_number, booked_via,
  chief_complaint, created_at
) values (
  '99999999-0000-0000-0000-000000000301',
  '99999999-0000-0000-0000-000000000001',
  '33333333-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-000000000001',
  '2026-09-21 20:00:00+00',
  30,
  'scheduled',
  'Primary Care Follow-up',
  'PRIMARY_CARE_FOLLOWUP',
  'Routine follow-up',
  'HLS-8421',
  'agent',
  'Routine follow-up',
  now()
)
on conflict (id) do update set
  start_at = excluded.start_at,
  status = case when public.epic_appointments.status in ('cancelled', 'rescheduled') then public.epic_appointments.status else 'scheduled' end,
  confirmation_number = excluded.confirmation_number;
