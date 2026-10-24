'use client';

import { useEffect, useRef, useState } from 'react';
import type { JournalEntrySummary, VaultPort } from '@/lib/backend/ports';
import { Button } from '@/components/ui/button';

/** Mounted only while the current account's vault is unlocked. Content never leaves this component. */
export function SavedJournals({ vault, version }: { vault: VaultPort; version: number }) {
  const [entries, setEntries] = useState<JournalEntrySummary[]>([]);
  const [opened, setOpened] = useState<{ localId: string; text: string; reflection: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void vault.listJournals().then(rows => {
      if (active) setEntries(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }).catch(() => { if (active) setError('Could not read saved entries.'); });
    return () => { active = false; request.current++; };
  }, [vault, version, refresh]);
  async function read(localId: string) {
    const id = ++request.current;
    setError(null);
    try {
      const [entry, reflection] = await Promise.all([vault.readJournal(localId), vault.readReflection(localId)]);
      if (id === request.current && !vault.locked) setOpened({ localId, text: entry.text, reflection });
    } catch { if (id === request.current) setError('Could not open this entry.'); }
  }
  async function remove(localId: string) {
    if (!window.confirm('Delete this saved entry and its reflection from this device?')) return;
    request.current++;
    setOpened(null);
    try { await vault.deleteJournal(localId); setRefresh(n => n + 1); }
    catch { setError('Could not delete this entry.'); }
  }
  return <section className="space-y-3" aria-labelledby="saved-journals-heading">
    <h2 id="saved-journals-heading" className="text-lg font-semibold">Saved on this device</h2>
    <Button variant="outline" onClick={() => setRefresh(n => n + 1)}>Refresh saved entries</Button>
    {!entries.length && <p className="text-sm text-muted-foreground">No saved entries yet.</p>}
    <ul className="divide-y">{entries.map(entry => <li key={entry.localId} className="flex items-center gap-2 py-2">
      <Button variant="outline" onClick={() => void read(entry.localId)}>{new Date(entry.createdAt).toLocaleString()}</Button>
      <Button variant="ghost" onClick={() => void remove(entry.localId)}>Delete</Button>
    </li>)}</ul>
    {opened && <article className="space-y-3 rounded-md border p-4">
      <Button variant="ghost" onClick={() => { request.current++; setOpened(null); }}>Close entry</Button>
      <p className="whitespace-pre-wrap">{opened.text}</p>
      {opened.reflection && <><h3 className="font-medium">Saved reflection</h3><p className="whitespace-pre-wrap">{opened.reflection}</p></>}
    </article>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
