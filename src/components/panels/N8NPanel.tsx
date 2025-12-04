import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Globe, Loader2, Play, Plus, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { RightPanel } from '../layout/RightPanel';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Separator } from '../ui/Separator';
import {
  createN8NIntegration,
  deleteN8NIntegration,
  listN8NIntegrations,
  N8NIntegration,
  triggerN8NWebhook,
  updateN8NIntegration
} from '../../lib/n8n-service';
import { cn } from '../../lib/utils';

interface N8NPanelProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string | null;
  onIntegrationsChanged?: () => void;
}

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

const defaultHeaderRow = (): HeaderRow => ({
  id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
  key: '',
  value: ''
});

export function N8NPanel({ isOpen, onClose, configId, onIntegrationsChanged }: N8NPanelProps) {
  const [integrations, setIntegrations] = useState<N8NIntegration[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<HeaderRow[]>([defaultHeaderRow()]);

  const [form, setForm] = useState({
    name: '',
    description: '',
    webhook_url: '',
    http_method: 'POST' as 'POST' | 'PUT' | 'PATCH',
    secret: '',
    forward_session_context: true,
    enabled: true
  });

  useEffect(() => {
    if (isOpen && configId) {
      loadIntegrations(configId);
    }
  }, [isOpen, configId]);

  const loadIntegrations = async (cfgId: string) => {
    setIsLoading(true);
    try {
      const data = await listN8NIntegrations(cfgId);
      setIntegrations(data);
    } catch (error) {
      console.error('Failed to load n8n integrations', error);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      webhook_url: '',
      http_method: 'POST',
      secret: '',
      forward_session_context: true,
      enabled: true
    });
    setHeaders([defaultHeaderRow()]);
    setFormError(null);
  };

  const handleCreate = async () => {
    if (!configId) return;
    if (!form.name.trim() || !form.webhook_url.trim()) {
      setFormError('Name and webhook URL are required');
      return;
    }
    if (!form.webhook_url.startsWith('https://')) {
      setFormError('Use an HTTPS webhook URL to avoid mixed content and CORS issues.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const customHeaders = headers.reduce<Record<string, string>>((acc, row) => {
        if (row.key.trim()) {
          acc[row.key.trim()] = row.value;
        }
        return acc;
      }, {});

      await createN8NIntegration(configId, {
        ...form,
        custom_headers: customHeaders,
        secret: form.secret || null
      });
      await loadIntegrations(configId);
      onIntegrationsChanged?.();
      resetForm();
    } catch (error: any) {
      console.error('Failed to create integration', error);
      setFormError(error.message || 'Failed to create integration');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!configId) return;
    if (!confirm('Delete this n8n integration? This cannot be undone.')) return;
    try {
      await deleteN8NIntegration(id);
      await loadIntegrations(configId);
      onIntegrationsChanged?.();
    } catch (error) {
      console.error('Failed to delete integration', error);
    }
  };

  const handleToggle = async (integration: N8NIntegration) => {
    try {
      await updateN8NIntegration(integration.id, {
        enabled: !integration.enabled
      });
      if (configId) {
        await loadIntegrations(configId);
      }
      onIntegrationsChanged?.();
    } catch (error) {
      console.error('Failed to toggle integration', error);
    }
  };

  const handleTest = async (integration: N8NIntegration) => {
    try {
      await triggerN8NWebhook({
        integrationId: integration.id,
        summary: 'Connectivity test from Voice Agent',
        severity: 'low',
        payload: {
          ping: true,
          message: 'If you see this inside n8n, the connection is working.'
        }
      });
      alert('Webhook triggered successfully. Check your n8n execution logs.');
    } catch (error: any) {
      alert(error.message || 'Failed to trigger n8n webhook');
    }
  };

  const headerList = useMemo(() => headers, [headers]);

  const handleHeaderChange = (id: string, field: 'key' | 'value', value: string) => {
    setHeaders(current => current.map(row => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const handleAddHeader = () => {
    setHeaders(current => [...current, defaultHeaderRow()]);
  };

  const handleRemoveHeader = (id: string) => {
    setHeaders(current => current.filter(row => row.id !== id));
  };

  return (
    <RightPanel
      isOpen={isOpen}
      onClose={onClose}
      title="n8n Webhook Integrations"
      subtitle="Securely trigger automations without exposing CORS or browser secrets."
    >
      <div className="p-6 space-y-6">
        {!configId && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-gray-500">
              <Shield className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              Select or create an agent configuration before wiring up n8n.
            </CardContent>
          </Card>
        )}

        {configId && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Add integration</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      We store the webhook server-side and relay events through a Supabase Edge
                      Function so browsers never deal with CORS or secrets.
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {formError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
                    {formError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Name</label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Incident bridge, CRM sync..."
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">HTTP method</label>
                    <select
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={form.http_method}
                      onChange={(e) => setForm({ ...form, http_method: e.target.value as 'POST' | 'PUT' | 'PATCH' })}
                    >
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Webhook URL</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="https://n8n.yourcompany.com/webhook/..."
                    value={form.webhook_url}
                    onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Description</label>
                  <textarea
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Shared secret (optional)</label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Used to HMAC-sign payloads"
                      value={form.secret}
                      onChange={(e) => setForm({ ...form, secret: e.target.value })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={form.forward_session_context}
                      onChange={(e) => setForm({ ...form, forward_session_context: e.target.checked })}
                    />
                    Include session context (agent, session & user IDs)
                  </label>
                </div>

                <Separator />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Custom headers
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs px-2 py-1"
                      onClick={handleAddHeader}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add header
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {headerList.map(header => (
                      <div key={header.id} className="grid grid-cols-2 gap-2 items-center">
                        <input
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="X-Webhook-Token"
                          value={header.key}
                          onChange={(e) => handleHeaderChange(header.id, 'key', e.target.value)}
                        />
                        <div className="flex gap-2">
                          <input
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            placeholder="value"
                            value={header.value}
                            onChange={(e) => handleHeaderChange(header.id, 'value', e.target.value)}
                          />
                          <button
                            type="button"
                            className="rounded-lg border border-gray-200 px-2 py-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => handleRemoveHeader(header.id)}
                            disabled={headerList.length === 1}
                          >
                            <Trash2 className="w-4 h-4 text-gray-500" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full justify-center"
                  onClick={handleCreate}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Save integration
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">
                    Connected automations
                  </h3>
                  <Badge variant="secondary">{integrations.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading integrations…
                  </div>
                )}
                {!isLoading && integrations.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                    <Globe className="w-6 h-6 mx-auto mb-2 text-gray-400" />
                    No n8n automations connected yet.
                  </div>
                )}
                {integrations.map(integration => (
                  <div
                    key={integration.id}
                    className={cn(
                      'border rounded-lg p-4 space-y-2',
                      integration.enabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{integration.name}</p>
                        {integration.description && (
                          <p className="text-xs text-gray-500">{integration.description}</p>
                        )}
                      </div>
                      <Badge variant={integration.enabled ? 'success' : 'secondary'}>
                        {integration.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500 break-all">{integration.webhook_url}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Copy className="w-3 h-3" /> {integration.http_method}
                      </span>
                      {integration.last_trigger_at && (
                        <span className="inline-flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" />
                          Last run {new Date(integration.last_trigger_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleTest(integration)}>
                        <Play className="w-3 h-3 mr-1" />
                        Send test
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleToggle(integration)}>
                        {integration.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(integration.id)}>
                        <Trash2 className="w-3 h-3 mr-1" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 flex gap-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">Security tips</p>
                <ul className="list-disc list-inside space-y-1 mt-1">
                  <li>Restrict n8n webhook URLs to HTTPS and private workspaces.</li>
                  <li>Use the optional shared secret to verify <code>x-va-signature</code> in n8n.</li>
                  <li>Store API keys inside n8n, not in the voice agent.</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </RightPanel>
  );
}
