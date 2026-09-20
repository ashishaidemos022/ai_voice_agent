# HLS patient-access voice showcase

The `HLS Patient Access · Jev + GPT-Live` agent demonstrates a complete patient-access call using GPT-Live-1, TypeSafe Jev, and the connected Supabase EHR.

## Supported conversation

- Verify the caller with date of birth and postal code before disclosing protected information.
- Find the next appointment and read back its provider, department, visit type, location, and confirmation number.
- Check an open referral and search eligible appointment slots.
- Book, reschedule, or cancel only after an explicit confirmation of the exact appointment.
- Answer visit-logistics questions from EHR location and department records.
- Route clinical questions, emergencies, unsupported specialties or modalities, coverage questions, and explicit human requests to staff.

Jev classifies the current intent, chooses a next workflow step, and scores whether human review is needed on each substantive turn. Deterministic policy still enforces identity verification, exact-record selection, explicit confirmation, specialty matching, and emergency handling.

## Showcase patient

- Name: Amelia Hart
- Patient reference used internally by the configured agent: `DEMO-1001`
- Date of birth: `1988-04-12`
- Postal code: `75219`
- Upcoming appointment: primary-care follow-up on September 21, 2026 at 3:00 PM Central
- Open referral: cardiology consult
- Available referral slots: September 22–28, 2026

## Suggested multi-turn call

1. “I’m calling to check my next appointment.”
2. When asked, provide `April 12, 1988` and `75219`.
3. Ask, “Where is it, and who am I seeing?”
4. Ask, “I also have a cardiology referral. Is it ready to schedule?”
5. Ask for afternoon availability.
6. Choose one offered slot and ask to reschedule the existing appointment.
7. Confirm only after the agent repeats both the current appointment and replacement time.
8. Ask a clinical question to demonstrate the staff handoff boundary.

## Runtime configuration

The deployed patient-access function requires these Supabase function secrets:

- `TYPESAFE_API_KEY`
- `EHR_SUPABASE_URL`
- `EHR_SUPABASE_SERVICE_ROLE_KEY`

The voice agent uses the purpose-built `healthcare_patient_access` tool rather than exposing unrestricted SQL to the voice model. The tool reads the same Supabase EHR records, runs Jev for every turn, and permits EHR changes only after the verification and confirmation gates pass.
