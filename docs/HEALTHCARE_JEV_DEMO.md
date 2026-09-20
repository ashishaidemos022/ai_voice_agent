# HLS Patient Access · Jev + GPT-Live-1

This showcase uses a synthetic patient journey. It must never be presented as a real Epic connection or a clinical decision-support system.

## What the audience sees

- GPT-Live-1 carries the full-duplex voice conversation and handles interruptions.
- The delegated backend calls `healthcare_patient_access` for each substantive administrative turn.
- Jev classifies intent, recommends the next workflow step, and reports uncertainty.
- Ashish_EHR supplies the open referral, eligible appointment slots, and the final synthetic appointment record.
- The tool execution panel shows the applied Jev decision beside the EHR evidence.

## Demo patient

- Reference: `DEMO-1001`
- Name: Amelia Hart
- Scenario: open routine cardiology referral
- Data classification: explicitly synthetic

## Rehearsal

1. Select **HLS Patient Access · Jev + GPT-Live** and start a native voice session.
2. Say: “I have a cardiology referral and I can only do afternoons. What is available next week?”
3. Show the Jev intent, confidence, applied action, referral, and three eligible slots in the tool panel.
4. Select one offered time. The agent should repeat the exact provider, date, time, and in-person modality and ask for confirmation.
5. Interrupt with: “Actually, make that the Thursday afternoon option.” Verify that the prior choice is not scheduled.
6. Confirm the restated Thursday option. The tool should return a synthetic confirmation number and the UI should show **Synthetic appointment scheduled**.
7. Ask: “Does this mean my chest pressure is heart disease?” The workflow must route to staff and avoid clinical interpretation. If the utterance includes current chest pain or breathing difficulty, the deterministic emergency-language gate must take precedence.

## Required secrets

The `healthcare-patient-access` Edge Function requires:

- `TYPESAFE_API_KEY`
- `EHR_SUPABASE_URL`
- `EHR_SUPABASE_SERVICE_ROLE_KEY`

The EHR credentials are server-side only. The function rejects every patient reference except `DEMO-1001`, and only a confirmed slot returned for that synthetic patient can be scheduled.

## Deployment

1. Seed the synthetic patient, referral, and future cardiology slots in Ashish_EHR.
2. Apply `20260920120000_add_healthcare_jev_demo.sql` to the voice-agent Supabase project.
3. Deploy `healthcare-patient-access` and the updated `realtime-session` function.
4. Deploy the frontend.
5. Run `npm run test:healthcare-demo`, `npm run test:voice`, `npm run typecheck`, and `npm run build` before the live microphone rehearsal.
