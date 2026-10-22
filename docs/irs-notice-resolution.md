# IRS Notice & Refund Resolution Concierge

The agent **IRS Notice & Refund Concierge · Jev + Eleven Max** helps a caller understand a tax notice, a held refund, missing documents, an existing proposed or active payment plan, and the status of a resolution case. Jev determines the next administrative step on every substantive request; ElevenLabs Realtime v1 Max provides the conversation and voice. The published voice is Matilda (`XrExE9yKIg1WjnnlVkGX`). The greeting, instructions, and tool descriptions use normal account-support language, with no demonstration labels. Callers supply a four-digit reference such as `4827`; the backend maps it to the existing internal taxpayer reference. The public tool field is `access_code`; the stored column retains its existing name.

## Connected data

| Table | Agent use |
| --- | --- |
| `irs_taxpayers` | Match the caller's four-digit reference, access code, and mailing ZIP before account disclosure. |
| `irs_notices` | Explain notice type, tax year, stored balance/refund, status, and response deadline. |
| `irs_resolution_cases` | Explain the recorded next step and identify high risk or conflicting case records. |
| `irs_case_documents` | Distinguish required, missing, received, and reviewed documents with stored due dates. |
| `irs_payment_plans` | Review recorded plan terms; distinguish a proposal from an active agreement. |
| `irs_tasks` | Read existing specialist work status. |
| `irs_interactions` | Read recent case history and append an audit event for a verified agent review. |
| `irs_kb_articles` | Supply supporting notice explanations, without turning old timelines or thresholds into guarantees. |

The preset is scoped to the existing `IRS-DEMO-*` references. Stored `identity_status=VERIFIED` is insufficient: the server rechecks caller-supplied access factors on every request. No access code, ZIP, full taxpayer record, or raw request is written into the new interaction audit events. Tool execution inputs redact the access code and ZIP. Spoken caller input can still appear in the platform's normal conversation transcript; these are demo factors, not real taxpayer credentials.

## Decisioning and behavior

The `irs_notice_resolution` client tool invokes the authenticated `irs-notice-resolution` Supabase function with the selected preset ID supplied by the application. The function verifies preset ownership, that the workflow tool is selected, and that the requested demo taxpayer reference is allowed. It scopes cases and notices to that taxpayer and scopes documents, tasks, and interactions to those cases.

The function sends Jev the redacted request, server date, verification state, notice/case/document statuses, existing plan statuses, and risk flags. It requests intent, next step, and human-review decisions. Low confidence, missing/malformed decisions, caller requests for a person, hardship, overdue deadlines, high risk, or conflicting case records result in specialist guidance. If Jev is unavailable, the function returns an error without a fallback decision or account data. The results include Jev model, token usage, and timing for the existing tool execution feed. Argument normalization preserves access-code case; a recipient-field heuristic was narrowed so the letters “cc” inside `access_code` do not turn credentials into lowercase email recipients.

The workflow reviews data and records an interaction. It does not assess taxes, approve or create plans, collect payments, upload documents, change deadlines, or contact the IRS. Specialist guidance uses the contact details on the caller's actual notice; it does not claim that a handoff was submitted. CP2000 proposals are distinguished from assessed bills, and a CP05 review never comes with a promised refund release date. General guidance was checked against [IRS CP2000 information](https://www.irs.gov/taxtopics/tc652) and [Taxpayer Advocate CP05 information](https://www.taxpayeradvocate.irs.gov/notices/notice-cp05/).

The prompt puts a very friendly, vividly expressive female persona near the beginning so it applies throughout the call. It asks for a smile in her voice, lively melodic intonation, animated emphasis, varied pacing, specific personal acknowledgments, and brighter energy around useful findings and next steps. It includes concrete delivery examples and softens the tone for financial stress. The opening is conversational and the temperature is 0.65. Facts, amounts, dates, verification, and Jev decisions stay grounded in the tools. Realtime Max controls its own TTS and expressive mode, so the prompt supplies the behavioral guidance rather than relying on a separate TTS toggle.

## Setup and testing

The agent exists under the owner of the configured ElevenLabs key. Refresh the platform, select the named preset, and start a new Native voice conversation. Supply the four-digit suffix of an existing taxpayer reference and the corresponding `demo_access_code` and `mailing_zip` from the taxpayer table. Ask, for example, “Why is my refund being held?” or “Which documents are still missing?” Let the agent request verification before expecting account facts.

Deploy the function:

```sh
supabase functions deploy irs-notice-resolution --project-ref YOUR_PROJECT_REF --use-api
```

Create/update the preset and publish a dedicated ElevenLabs agent using the existing provider key:

```sh
node scripts/setup-irs-agent.mjs --project-ref YOUR_PROJECT_REF --owner-id YOUR_VA_USER_ID
```

The setup script requires Supabase CLI authentication, keeps service/provider credentials in memory, and reuses only this named preset's own remote agent on subsequent runs. It never repoints another preset's remote agent.

Run `npm run test:irs` for isolation, identity, Jev failure, stale/conflicting records, and credential-log redaction coverage. `node scripts/irs-agent-smoke.mjs --project-ref YOUR_PROJECT_REF` exercises the deployed function and live Jev using a temporary authenticated account. It sends no email and removes the temporary account, preset, and review interactions afterward. It requires the existing `IRS-DEMO-4827` record and its seeded conflicting case data. The smoke test covers the deployed data/decision path; it does not test a microphone conversation.
