import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AgentPanel = 'session' | 'settings' | 'logs';

export type ToolSelectionCache = {
  mcp: string[];
  n8n: string[];
};

type ToolSelections = Record<string, ToolSelectionCache>;

interface AgentUIState {
  activeConfigId: string | null;
  activePanel: AgentPanel;
  preferredModel: string;
  preferredVoice: string;
  toolSelections: ToolSelections;
  setActiveConfigId: (id: string | null) => void;
  setActivePanel: (panel: AgentPanel) => void;
  setPreferredModel: (model: string) => void;
  setPreferredVoice: (voice: string) => void;
  setToolsForConfig: (configId: string, tools: ToolSelectionCache) => void;
}

const defaultModel = 'gpt-realtime';
const defaultVoice = 'alloy';

const fallbackStorage: Storage = {
  get length() {
    return 0;
  },
  clear() {},
  getItem(_key: string) {
    return null;
  },
  key(_index: number) {
    return null;
  },
  removeItem(_key: string) {},
  setItem(_key: string, _value: string) {}
};

const safeSessionStorage = () => {
  if (typeof window === 'undefined') {
    return fallbackStorage;
  }
  return sessionStorage;
};

export const useAgentState = create<AgentUIState>()(
  persist(
    (set) => ({
      activeConfigId: null,
      activePanel: 'session',
      preferredModel: defaultModel,
      preferredVoice: defaultVoice,
      toolSelections: {},
      setActiveConfigId: (id) => set({ activeConfigId: id }),
      setActivePanel: (panel) => set({ activePanel: panel }),
      setPreferredModel: (model) => set({ preferredModel: model || defaultModel }),
      setPreferredVoice: (voice) => set({ preferredVoice: voice || defaultVoice }),
      setToolsForConfig: (configId, tools) => set((state) => ({
        toolSelections: {
          ...state.toolSelections,
          [configId]: {
            mcp: [...(tools.mcp || [])],
            n8n: [...(tools.n8n || [])]
          }
        }
      }))
    }),
    {
      name: 'agent-ui-state',
      storage: createJSONStorage(safeSessionStorage)
    }
  )
);
