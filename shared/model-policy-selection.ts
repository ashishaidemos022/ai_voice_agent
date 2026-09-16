export type ModelPolicyMode = 'rag' | 'adapter' | 'automatic';

export type ModelPolicySelection = {
  mode: ModelPolicyMode;
  adapterId: string;
};

export function chooseModelPolicy(mode: ModelPolicyMode, adapterId: string): ModelPolicySelection {
  return { mode, adapterId: mode === 'rag' ? '' : adapterId };
}

export function chooseTrainedAdapter(currentMode: ModelPolicyMode, adapterId: string): ModelPolicySelection {
  return {
    mode: adapterId ? 'adapter' : currentMode === 'adapter' ? 'rag' : currentMode,
    adapterId
  };
}
