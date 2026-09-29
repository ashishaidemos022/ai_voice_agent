import type { Scenario } from '../types.ts';
import { HEALTHCARE_SCENARIOS } from './healthcare.ts';

export const SCENARIOS: Scenario[] = HEALTHCARE_SCENARIOS;

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
