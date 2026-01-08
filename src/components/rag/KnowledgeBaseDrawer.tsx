import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Plus, RefreshCcw, Upload, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import {
  archiveKnowledgeDocument,
  createKnowledgeSpace,
  ingestKnowledgeText,
  listKnowledgeDocuments,
  listKnowledgeSpaces,
  listRagLogs,
  toggleAgentSpaceBinding,
  updateAgentRagSettings,
  uploadKnowledgeFile
} from '../../lib/rag-service';
import type { RagDocument, RagLogEntry, RagSpace } from '../../types/rag';
import type { AgentConfigPreset } from '../../lib/config-service';
import { getAllConfigPresets } from '../../lib/config-service';

interface KnowledgeBaseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KnowledgeBaseDrawer({ isOpen, onClose }: KnowledgeBaseDrawerProps) {
  const [spaces, setSpaces] = useState<RagSpace[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [logs, setLogs] = useState<RagLogEntry[]>([]);
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceDescription, setNewSpaceDescription] = useState('');
  const [textContent, setTextContent] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [isLoadingSpaces, setIsLoadingSpaces] = useState(false);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSpace = useMemo(() => spaces.find((space) => space.id === selectedSpaceId) || null, [spaces, selectedSpaceId]);

  useEffect(() => {
    if (!isOpen) return;
    refreshAll();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedSpaceId) return;
    loadDocuments(selectedSpaceId);
  }, [isOpen, selectedSpaceId]);

  async function refreshAll() {
    setError(null);
    setIsLoadingSpaces(true);
    try {
      const [spaceData, presetData, logData] = await Promise.all([
        listKnowledgeSpaces(),
        getAllConfigPresets(),
        listRagLogs()
      ]);
      setSpaces(spaceData);
      setPresets(presetData);
      setLogs(logData);
      if (!selectedSpaceId && spaceData.length > 0) {
        setSelectedSpaceId(spaceData[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load knowledge base');
    } finally {
      setIsLoadingSpaces(false);
    }
  }

  async function loadDocuments(spaceId: string) {
    setIsLoadingDocs(true);
    setError(null);
    try {
      const docs = await listKnowledgeDocuments(spaceId);
      setDocuments(docs);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setIsLoadingDocs(false);
    }
  }

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) return;
    setError(null);
    try {
      const space = await createKnowledgeSpace({
        name: newSpaceName.trim(),
        description: newSpaceDescription.trim() || undefined
      });
      setSpaces((prev) => [...prev, space]);
      setSelectedSpaceId(space.id);
      setNewSpaceName('');
      setNewSpaceDescription('');
    } catch (err: any) {
      setError(err.message || 'Failed to create knowledge space');
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSpaceId) return;
    setIsUploading(true);
    setError(null);
    try {
      await uploadKnowledgeFile(selectedSpaceId, file);
      await loadDocuments(selectedSpaceId);
    } catch (err: any) {
      setError(err.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleTextIngest = async () => {
    if (!selectedSpaceId || !textContent.trim()) return;
    setIsUploading(true);
    setError(null);
    try {
      await ingestKnowledgeText(selectedSpaceId, textContent.trim(), textTitle.trim() || undefined);
      setTextContent('');
      setTextTitle('');
      await loadDocuments(selectedSpaceId);
    } catch (err: any) {
      setError(err.message || 'Failed to ingest text');
    } finally {
      setIsUploading(false);
    }
  };

  const handleArchiveDoc = async (docId: string) => {
    if (!selectedSpaceId) return;
    await archiveKnowledgeDocument(docId);
    await loadDocuments(selectedSpaceId);
  };

  const handleToggleBinding = async (agentId: string, spaceId: string, enabled: boolean) => {
    try {
      await toggleAgentSpaceBinding(agentId, spaceId, enabled);
      setPresets((prev) =>
        prev.map((preset) => {
          if (preset.id !== agentId) return preset;
          const existing = preset.knowledge_spaces || [];
          if (enabled) {
            if (existing.some((binding) => binding.space_id === spaceId)) return preset;
            return {
              ...preset,
              knowledge_spaces: [
                ...existing,
                {
                  id: crypto.randomUUID(),
                  agent_config_id: agentId,
                  space_id: spaceId,
                  created_at: new Date().toISOString(),
                  rag_space: spaces.find((space) => space.id === spaceId) || null
                }
              ]
            };
          }
          return {
            ...preset,
            knowledge_spaces: existing.filter((binding) => binding.space_id !== spaceId)
          };
        })
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update binding');
    }
  };

  const handleToggleRag = async (agentId: string, enabled: boolean) => {
    try {
      await updateAgentRagSettings(agentId, { rag_enabled: enabled });
      setPresets((prev) => prev.map((preset) => (preset.id === agentId ? { ...preset, rag_enabled: enabled } : preset)));
    } catch (err: any) {
      setError(err.message || 'Failed to update agent mode');
    }
  };

  const handleModeChange = async (agentId: string, mode: 'assist' | 'guardrail') => {
    try {
      await updateAgentRagSettings(agentId, { rag_mode: mode });
      setPresets((prev) => prev.map((preset) => (preset.id === agentId ? { ...preset, rag_mode: mode } : preset)));
    } catch (err: any) {
      setError(err.message || 'Failed to update RAG mode');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="bg-slate-950 text-white rounded-3xl shadow-2xl border border-white/35 w-full max-w-6xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/10">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Knowledge Spaces</p>
            <h2 className="text-2xl font-semibold">Retrieval Grounding Console</h2>
            {error && <p className="text-sm text-rose-300 mt-1">{error}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoadingSpaces}>
              <RefreshCcw className="w-4 h-4" /> Refresh
            </Button>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6 p-6 flex-1 overflow-hidden">
          <Card className="bg-slate-900/40 border-white/10 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">Spaces</p>
              {isLoadingSpaces && <span className="text-xs text-white/50">Loading…</span>}
            </div>
            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {spaces.map((space) => (
                <button
                  key={space.id}
                  onClick={() => setSelectedSpaceId(space.id)}
                  className={`w-full text-left rounded-2xl border px-3 py-2 transition ${
                    space.id === selectedSpaceId ? 'border-white/60 bg-white/10' : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  <p className="font-semibold text-sm">{space.name}</p>
                  <p className="text-xs text-white/50 line-clamp-2">{space.description || 'No description'}</p>
                  <p className="text-[11px] text-white/40 mt-1">Status: {space.status}</p>
                </button>
              ))}
              {spaces.length === 0 && <p className="text-sm text-white/50">No knowledge spaces yet.</p>}
            </div>
            <div className="pt-3 border-t border-white/5 mt-4">
              <input
                type="text"
                value={newSpaceName}
                onChange={(event) => setNewSpaceName(event.target.value)}
                placeholder="Space name"
                className="w-full mb-2 rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={newSpaceDescription}
                onChange={(event) => setNewSpaceDescription(event.target.value)}
                placeholder="Description"
                className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm"
              />
              <Button className="w-full mt-3" onClick={handleCreateSpace} disabled={!newSpaceName.trim()}>
                <Plus className="w-4 h-4" />
                Create space
              </Button>
            </div>
          </Card>

          <Card className="bg-slate-900/40 border-white/10 p-4 flex flex-col overflow-hidden">
            <p className="text-sm font-semibold mb-3">Documents</p>
            {!selectedSpace && <p className="text-sm text-white/50">Select a space to view documents.</p>}
            {selectedSpace && (
              <div className="flex flex-col gap-3 overflow-y-auto flex-1 pr-1">
                {isLoadingDocs && <p className="text-xs text-white/50">Loading documents…</p>}
                {documents.map((doc) => (
                  <div key={doc.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <p className="font-semibold">{doc.title || doc.openai_filename || 'Untitled'}</p>
                      <button
                        type="button"
                        className="text-xs text-white/60 hover:text-white"
                        onClick={() => handleArchiveDoc(doc.id)}
                      >
                        Archive
                      </button>
                    </div>
                    <p className="text-[11px] text-white/40">{doc.source_type} • {doc.status}</p>
                  </div>
                ))}
                {documents.length === 0 && !isLoadingDocs && (
                  <p className="text-sm text-white/50">No documents yet.</p>
                )}
              </div>
            )}
            {selectedSpace && (
              <div className="pt-4 border-t border-white/5 mt-4 space-y-3">
                <label className="text-xs text-white/50">Upload file</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  disabled={isUploading}
                  className="text-sm text-white/70"
                />
                <div>
                  <label className="text-xs text-white/50">Paste text</label>
                  <textarea
                    rows={4}
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm"
                    placeholder="Paste SOPs, snippets, or notes"
                  />
                  <input
                    type="text"
                    value={textTitle}
                    onChange={(event) => setTextTitle(event.target.value)}
                    placeholder="Optional title"
                    className="w-full mt-2 rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm"
                  />
                  <Button
                    className="w-full mt-2"
                    onClick={handleTextIngest}
                    disabled={!textContent.trim() || isUploading}
                  >
                    <Upload className="w-4 h-4" /> Ingest text
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="bg-slate-900/40 border-white/10 p-4 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">Agent bindings</p>
              <span className="text-xs text-white/40">{presets.length} agents</span>
            </div>
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {presets.map((preset) => {
                const isAttached = selectedSpace
                  ? (preset.knowledge_spaces || []).some((binding) => binding.space_id === selectedSpace.id)
                  : false;
                return (
                  <div key={preset.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{preset.name}</p>
                        <p className="text-[11px] text-white/50">RAG: {preset.rag_enabled ? preset.rag_mode : 'disabled'}</p>
                      </div>
                      {selectedSpace && (
                        <button
                          type="button"
                          className={`text-xs px-3 py-1 rounded-full border ${isAttached ? 'border-emerald-400/60 text-emerald-300' : 'border-white/20 text-white/60'}`}
                          onClick={() => handleToggleBinding(preset.id, selectedSpace.id!, !isAttached)}
                        >
                          <Link2 className="w-3 h-3 inline mr-1" />
                          {isAttached ? 'Connected' : 'Attach'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs mt-2">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preset.rag_enabled}
                          onChange={(event) => handleToggleRag(preset.id, event.target.checked)}
                        />
                        Enable RAG
                      </label>
                      <select
                        value={preset.rag_mode}
                        onChange={(event) => handleModeChange(preset.id, event.target.value as 'assist' | 'guardrail')}
                        className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-white/80"
                      >
                        <option value="assist">Assist</option>
                        <option value="guardrail">Guardrail</option>
                      </select>
                    </div>
                  </div>
                );
              })}
              {presets.length === 0 && <p className="text-sm text-white/50">No agents configured yet.</p>}
            </div>
            <div className="pt-4 border-t border-white/5 mt-4">
              <p className="text-sm font-semibold mb-2">Recent retrieval logs</p>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1 text-xs">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-white/10 bg-black/30 p-2">
                    <p className="text-white/70 line-clamp-2">{log.query_text}</p>
                    <p className="text-white/40 mt-1">{new Date(log.created_at).toLocaleString()}</p>
                  </div>
                ))}
                {logs.length === 0 && <p className="text-white/50 text-xs">No RAG traffic yet.</p>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
