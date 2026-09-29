import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTHCARE_DEMO_PATIENT_REFERENCE, evalAccessError, isAllowedPatientReference, isEvalPatientReference, parseEvalRunId,
  slotQueryLimit
} from '../shared/healthcare-demo.ts';

const RUN = '7b0c2a52-6a0e-4a9f-9a57-1f2b3c4d5e6f';

test('patient reference allowlist', () => {
  assert.equal(isAllowedPatientReference(HEALTHCARE_DEMO_PATIENT_REFERENCE), true);
  assert.equal(isAllowedPatientReference('EVAL-0007'), true);
  assert.equal(isAllowedPatientReference('EVAL-7'), false);
  assert.equal(isAllowedPatientReference('DEMO-9999'), false);
  assert.equal(isEvalPatientReference('EVAL-0001'), true);
});

test('eval run id parsing', () => {
  assert.equal(parseEvalRunId(RUN), RUN);
  assert.equal(parseEvalRunId(RUN.toUpperCase()), RUN);
  assert.equal(parseEvalRunId('not-a-uuid'), null);
  assert.equal(parseEvalRunId(undefined), null);
});

test('eval patients and eval runs must travel together', () => {
  assert.equal(evalAccessError('EVAL-0001', RUN), null);
  assert.equal(evalAccessError(HEALTHCARE_DEMO_PATIENT_REFERENCE, null), null);
  assert.match(evalAccessError('EVAL-0001', null) || '', /require an eval run/);
  assert.match(evalAccessError(HEALTHCARE_DEMO_PATIENT_REFERENCE, RUN) || '', /must use an evaluation patient/);
});

test('eval patients see enough slots to reach every weekday; the demo patient keeps 8', () => {
  assert.equal(slotQueryLimit('EVAL-0001'), 15);
  assert.equal(slotQueryLimit(HEALTHCARE_DEMO_PATIENT_REFERENCE), 8);
});
