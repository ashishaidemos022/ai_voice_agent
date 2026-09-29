/* Run only in the Ashish_EHR project. Adds eval tagging and the voice-evaluator patients. */

alter table public.epic_appointments add column if not exists eval_run_id uuid;
create index if not exists epic_appointments_eval_run_id_idx
  on public.epic_appointments (eval_run_id) where eval_run_id is not null;

insert into public.epic_patients (
  id, mrn, first_name, last_name, email, preferred_language, mychart_active,
  coverage_summary, dob, postal_code, created_at
) values
  ('99999999-0000-0000-0000-00000000e001', 'EVAL-0001', 'Maya',   'Patel',  'eval-0001@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1979-03-14', '75204', now()),
  ('99999999-0000-0000-0000-00000000e002', 'EVAL-0002', 'Daniel', 'Brooks', 'eval-0002@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1965-11-02', '75206', now()),
  ('99999999-0000-0000-0000-00000000e003', 'EVAL-0003', 'Grace',  'Kim',    'eval-0003@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1990-07-21', '75214', now()),
  ('99999999-0000-0000-0000-00000000e004', 'EVAL-0004', 'Omar',   'Haddad', 'eval-0004@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1983-01-30', '75219', now()),
  ('99999999-0000-0000-0000-00000000e005', 'EVAL-0005', 'Lucia',  'Romero', 'eval-0005@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1972-09-08', '75225', now()),
  ('99999999-0000-0000-0000-00000000e006', 'EVAL-0006', 'Ethan',  'Walsh',  'eval-0006@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1995-05-17', '75230', now()),
  ('99999999-0000-0000-0000-00000000e007', 'EVAL-0007', 'Denise', 'Carter', 'eval-0007@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1958-12-03', '75201', now()),
  ('99999999-0000-0000-0000-00000000e008', 'EVAL-0008', 'Arjun',  'Mehta',  'eval-0008@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1969-06-16', '75080', now()),
  ('99999999-0000-0000-0000-00000000e009', 'EVAL-0009', 'Helen',  'Park',   'eval-0009@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1950-10-10', '75240', now()),
  ('99999999-0000-0000-0000-00000000e010', 'EVAL-0010', 'Robert', 'Lee',    'eval-0010@patient-access.example', 'English', true, '{"plan":"HLS Health Plan"}'::jsonb, '1961-04-25', '75243', now())
on conflict (id) do update set
  mrn = excluded.mrn, first_name = excluded.first_name, last_name = excluded.last_name,
  dob = excluded.dob, postal_code = excluded.postal_code;

insert into public.epic_referrals (
  id, patient_id, kind, target_specialty, target_provider_id,
  requesting_provider_id, urgency, status, ordered_at, notes, created_at
)
select
  ('99999999-0000-0000-0000-00000000f' || lpad(n::text, 3, '0'))::uuid,
  ('99999999-0000-0000-0000-00000000e' || lpad(n::text, 3, '0'))::uuid,
  'referral', 'Cardiology consult',
  '33333333-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001',
  'routine', 'open', '2026-09-18 15:00:00+00', 'Voice evaluator referral.', now()
from generate_series(1, 10) as n
on conflict (id) do update set status = 'open', scheduled_at = null, notes = excluded.notes;
