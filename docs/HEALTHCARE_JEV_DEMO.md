# HLS patient-access voice showcase

The `HLS Patient Access · Jev + GPT-Live` agent demonstrates a complete patient-access call using GPT-Live-1, TypeSafe Jev, and the connected Supabase EHR.

## Supported conversation

- Verify the caller with date of birth and postal code before disclosing protected information.
- Find the next appointment and read back its provider, department, visit type, location, and confirmation number.
- Check an open referral and search eligible appointment slots.
- Book, reschedule, or cancel only after an explicit confirmation of the exact appointment.
- Answer visit-logistics questions from EHR location and department records.
- Route clinical questions, emergencies, unsupported specialties or modalities, coverage questions, and explicit human requests to staff.
- Escalate a possible medical emergency to staff immediately, ahead of identity verification and every other gate.
- Ground relative dates with `get_current_time` using `America/Chicago`, and speak the EHR tool's preformatted `local_start.display` value for every appointment and slot.

Jev runs inside `healthcare_patient_access`: it classifies the current intent, chooses a next workflow step, and scores whether human review is needed on each substantive turn. The tool remains visible in the preset alongside `get_current_time`, and each completed Jev evaluation appears in the live decision popup. Deterministic policy still enforces identity verification, exact-record selection, explicit confirmation, specialty matching, and emergency handling.

## Urgent staff escalation

Jev scores a fourth question, `symptom_acuity`, on every turn: does the caller describe symptoms that could be a medical emergency? A turn escalates when either signal fires — the deterministic phrase list (chest pain, chest tightness, trouble breathing, stroke signs, severe bleeding, self-harm) or a Jev acuity score at or above 0.5. Either alone is enough, so wording the list cannot anticipate ("there's a lot of pressure in my chest") still escalates, and a literal phrase still escalates even if Jev scores the turn low.

An escalated turn returns `decision.urgency = "emergency"` and an `escalation` block carrying the priority, the acuity score, the care-team callback number (only once identity is verified), and the instruction the voice agent must follow: stop the workflow, tell the caller to hang up and call 911 or go to the nearest emergency department if symptoms are happening now, say a clinical staff member is being connected, hand off. The policy sets `mayMutate: false`, so no appointment is ever booked, moved, or cancelled on an escalated turn — and the check runs before the verification gate, so an emergency is never made to wait on a date of birth.

In the UI the decision card turns red, leads with the escalation instruction, shows the acuity score beside the human-review gauge, and stays on screen until it is dismissed instead of auto-closing.

## Speaking persona

The concierge is prompted to sound like a real scheduler: short thinking beats ("hmm, let me take a look"), light disfluencies such as a soft sigh or an "ah", and honest reactions to good and bad news — but never filler inside a date, time, address, or confirmation number, and never on an escalated turn, where it drops every filler and speaks plainly.

## Live decision popup

Every completed evaluation opens a full-width decision card that stays up for 16 seconds, or until it is dismissed by the close button, the Continue button, or a click outside the card. It shows:

- **Jev latency**, **Jev cost**, **tokens** (input/output), and the **tool round trip** including the EHR read.
- The **detected intent** and the **applied action**, each with its confidence and the top alternatives from the Jev probability distribution. When deterministic policy overrides Jev, the card names both the proposed and the applied step.
- The **needs-human-review** NOUL score, the verification state, and an emergency-language flag when one fires.
- **What the tool responded with**: tool status, the returned next step, any appointment change with its confirmation number, and the EHR evidence counts.

The same latency, cost, and token chips appear on the matching row in the Tool executions feed.

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
6. Choose one offered cardiology slot and ask to book it.
7. Confirm only after the agent repeats the selected appointment details.
8. Ask a clinical question to demonstrate the staff handoff boundary.

## Runtime configuration

The deployed patient-access function requires these Supabase function secrets:

- `TYPESAFE_API_KEY`
- `EHR_SUPABASE_URL`
- `EHR_SUPABASE_SERVICE_ROLE_KEY`

TypeSafe does not return a billed amount on `/systemone`, so the function prices each evaluation from the reported token usage and labels the figure "Estimated from token usage". Set the contracted rates with the optional secrets `TYPESAFE_JEV_INPUT_USD_PER_MTOK` and `TYPESAFE_JEV_OUTPUT_USD_PER_MTOK` (USD per million tokens); the defaults live in `shared/healthcare-demo.ts`. If TypeSafe ever returns `usage.cost_usd`, that value is used instead and the card reads "Billed by TypeSafe".

The voice agent uses the purpose-built `healthcare_patient_access` tool rather than exposing unrestricted SQL to the voice model. The tool reads the same Supabase EHR records, runs Jev for every turn, and permits EHR changes only after the verification and confirmation gates pass.
