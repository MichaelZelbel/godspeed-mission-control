import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Search by meaning: one setting for any service that speaks the OpenAI-style
// embeddings API (OpenRouter, OpenAI, a local Ollama). The key is kept on this
// device only and never shown again.
type Status = { configured: boolean; url: string | null; model: string | null; has_key: boolean; status: { indexed: number; pending: number; last_error: string | null; last_run: string | null } | null };
const presets = [
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/text-embedding-3-small' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  { label: 'Ollama on this computer', url: 'http://localhost:11434/v1', model: 'nomic-embed-text' },
];
export function MeaningSearch() {
  const qc = useQueryClient();
  const { data } = useQuery<Status>({ queryKey: ['embeddings'], queryFn: async () => (await fetch('/api/embeddings')).json(), refetchInterval: 10000 });
  const [url, setUrl] = useState(''), [model, setModel] = useState(''), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const connect = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, model, key }) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error || 'The service could not be reached');
      setKey(''); await qc.invalidateQueries({ queryKey: ['embeddings'] });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const disconnect = async () => { await fetch('/api/embeddings', { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['embeddings'] }); };
  const s = data?.status;
  return <section className="border rounded p-4 space-y-3" aria-labelledby="meaning-search-title">
    <h2 id="meaning-search-title" className="text-xl">Search by meaning</h2>
    {data?.configured ? <>
      <p>Connected to {data.url} with {data.model}. {s ? (s.pending ? `${s.indexed} of ${s.indexed + s.pending} notes and records ready; the rest follow in the background.` : `All ${s.indexed} notes and records can be found by meaning.`) : ''}</p>
      {s?.last_error && <p role="alert" className="text-destructive">The last attempt failed: {s.last_error}</p>}
      <Button variant="outline" onClick={disconnect}>Disconnect</Button>
    </> : <>
      <p>Search finds every word now. Connect an embeddings service and it also finds what you meant: "knee doctor" finds a note called "Orthopäde Termin". Your notes are sent to that service to be turned into numbers; nothing else is.</p>
      <div className="flex flex-wrap gap-2">{presets.map(p => <Button key={p.label} variant="outline" size="sm" onClick={() => { setUrl(p.url); setModel(p.model); }}>{p.label}</Button>)}</div>
      <div className="grid gap-2 max-w-xl">
        <Label htmlFor="meaning-url">Address</Label><Input id="meaning-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" />
        <Label htmlFor="meaning-model">Model</Label><Input id="meaning-model" value={model} onChange={e => setModel(e.target.value)} placeholder="openai/text-embedding-3-small" />
        <Label htmlFor="meaning-key">Key (not needed for Ollama)</Label><Input id="meaning-key" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" />
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button onClick={connect} disabled={busy || !url || !model}>{busy ? 'Checking…' : 'Connect'}</Button>
    </>}
  </section>;
}
