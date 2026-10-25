'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import type { PairView, VaultPort } from '@/lib/backend/ports';
import type { BookInteraction, RelationshipBookPhoto } from '@/vault/book-types';
import { useVault } from '@/lib/backend';
import { useLiveShared } from '@/components/shell/use-live';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MAX_PHOTO_BYTES = 1_500_000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const OUTCOME_COPY = { positive: 'Good', neutral: 'Okay', negative: 'Hard' } as const;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function BookContents({ pair, vault }: { pair: PairView; vault: VaultPort }) {
  const shared = useLiveShared();
  const [photos, setPhotos] = useState<RelationshipBookPhoto[]>([]);
  const [interactions, setInteractions] = useState<BookInteraction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [caption, setCaption] = useState('');
  const [note, setNote] = useState('');
  const [callOutcome, setCallOutcome] = useState<NonNullable<BookInteraction['outcome']>>('positive');
  const [introductionId, setIntroductionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const currentNudges = shared.myNudges().filter((n) => n.pairId === pair.pairId);
  const ownIntros = shared.myIntroductions();
  const feedbackIds = useMemo(() => new Set(interactions.filter((i) => i.kind === 'nudge_received' && i.outcome).map((i) => i.sourceId)), [interactions]);
  const unlinkedIntros = ownIntros.filter((i) => !interactions.some((x) => x.kind === 'introduction' && x.sourceId === i.introId));

  const refresh = async () => {
    const [nextPhotos, nextInteractions] = await Promise.all([
      vault.listRelationshipPhotos(pair.pairId), vault.listBookInteractions(pair.pairId),
    ]);
    setPhotos(nextPhotos);
    setInteractions(nextInteractions);
    setLoaded(true);
  };

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setPhotos([]);
    setInteractions([]);
    void Promise.all([vault.listRelationshipPhotos(pair.pairId), vault.listBookInteractions(pair.pairId)])
      .then(([nextPhotos, nextInteractions]) => {
        if (active) { setPhotos(nextPhotos); setInteractions(nextInteractions); setLoaded(true); }
      })
      .catch(() => { if (active) setMessage('The book could not be opened. Unlock or repair your local vault, then try again.'); });
    return () => { active = false; };
  }, [vault, pair.pairId]);

  useEffect(() => {
    if (!loaded) return;
    const unseen = currentNudges.filter((nudge) => !interactions.some((item) => item.kind === 'nudge_received' && item.sourceId === nudge.id));
    if (unseen.length === 0) return;
    let active = true;
    void Promise.all(unseen.map((nudge) => vault.saveBookInteraction({
      interactionId: `nudge-${nudge.id}`, pairId: pair.pairId, kind: 'nudge_received', sourceId: nudge.id, templateId: nudge.templateId,
    }))).then(() => active ? refresh() : undefined)
      .catch(() => { if (active) setMessage('A recent nudge could not be added to your local book.'); });
    return () => { active = false; };
  }, [currentNudges, interactions, loaded, pair.pairId, vault]);

  const savePhoto = async (file: File | undefined) => {
    setMessage(null);
    if (!file) return;
    if (!ALLOWED_MIME.has(file.type) || file.size > MAX_PHOTO_BYTES) {
      setMessage('Choose a JPEG, PNG, or WebP image under 1.5 MB.');
      return;
    }
    setBusy(true);
    try {
      await vault.saveRelationshipPhoto({
        photoId: crypto.randomUUID(), pairId: pair.pairId, mimeType: file.type as RelationshipBookPhoto['mimeType'],
        dataUrl: await readDataUrl(file), caption: caption.trim(),
      });
      setCaption('');
      await refresh();
      setMessage('Photo saved in your local encrypted vault.');
    } catch {
      setMessage('Photo could not be saved. Check that your vault is unlocked, the image is under the limit, and this book has room.');
    } finally { setBusy(false); }
  };

  const logCall = async () => {
    setBusy(true); setMessage(null);
    try {
      await vault.saveBookInteraction({
        interactionId: crypto.randomUUID(), pairId: pair.pairId, kind: 'call', outcome: callOutcome,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote(''); await refresh(); setMessage('Call added to your private book.');
    } catch { setMessage('Call could not be saved. Check that your vault is unlocked and try again.'); }
    finally { setBusy(false); }
  };

  const saveNudgeFeedback = async (nudgeId: string, outcome: NonNullable<BookInteraction['outcome']>) => {
    setBusy(true); setMessage(null);
    try {
      const nudge = currentNudges.find((item) => item.id === nudgeId);
      if (!nudge) throw new Error('not_found');
      const seen = interactions.find((item) => item.kind === 'nudge_received' && item.sourceId === nudgeId);
      await vault.saveBookInteraction({
        interactionId: seen?.interactionId ?? `nudge-${nudge.id}`, pairId: pair.pairId, kind: 'nudge_received',
        sourceId: nudgeId, templateId: nudge.templateId, outcome,
      });
      await refresh(); setMessage('Feedback saved on this device.');
    } catch { setMessage('Feedback could not be saved in your local vault.'); }
    finally { setBusy(false); }
  };

  const linkIntroduction = async () => {
    const intro = ownIntros.find((i) => i.introId === introductionId);
    if (!intro) return;
    setBusy(true); setMessage(null);
    try {
      await vault.saveBookInteraction({ interactionId: crypto.randomUUID(), pairId: pair.pairId, kind: 'introduction', sourceId: intro.introId });
      setIntroductionId(''); await refresh(); setMessage('Introduction added to this private book.');
    } catch { setMessage('Introduction could not be saved in your local vault.'); }
    finally { setBusy(false); }
  };

  const timeline = [...interactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mt-4 space-y-5 rounded-lg border bg-muted/20 p-4" aria-label={`Relationship book for ${pair.counterpartDisplayName ?? 'connection'}`}>
      <div>
        <h3 className="font-semibold">Your book</h3>
        <p className="text-xs text-muted-foreground">Photos, call notes and feedback stay in your unlocked local vault. Nothing here is sent to the other person or to an AI.</p>
      </div>
      <section className="space-y-3" aria-labelledby={`photos-${pair.pairId}`}>
        <h4 id={`photos-${pair.pairId}`} className="text-sm font-medium">Photos</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <figure key={photo.photoId} className="overflow-hidden rounded-md border bg-background">
              <Image src={photo.dataUrl} alt={photo.caption || `Photo in ${pair.counterpartDisplayName ?? 'connection'} book`} width={480} height={360} unoptimized className="aspect-[4/3] w-full object-cover" />
              <figcaption className="space-y-2 p-2">
                <p className="break-words text-xs text-muted-foreground">{photo.caption || 'No caption'}</p>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void vault.deleteRelationshipPhoto(pair.pairId, photo.photoId).then(refresh).catch(() => setMessage('Photo could not be removed.'))}>Remove</Button>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor={`caption-${pair.pairId}`}>Optional caption</Label>
            <Input id={`caption-${pair.pairId}`} value={caption} maxLength={120} onChange={(e) => setCaption(e.target.value)} placeholder="A memory you want to keep" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`photo-${pair.pairId}`}>Add a photo</Label>
            <Input id={`photo-${pair.pairId}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
              onChange={(e) => { const file = e.currentTarget.files?.[0]; void savePhoto(file); e.currentTarget.value = ''; }} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Choose an image from this device (JPEG, PNG or WebP, up to 1.5 MB). Apify and social-media scraping are not used.</p>
      </section>

      <section className="space-y-3 border-t pt-4" aria-labelledby={`log-call-${pair.pairId}`}>
        <h4 id={`log-call-${pair.pairId}`} className="text-sm font-medium">Log a call</h4>
        <p className="text-xs text-muted-foreground">dor does not read your phone call history. Add a call yourself, and optionally note how it felt.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Label className="space-y-1">How did it feel?
            <select value={callOutcome} onChange={(e) => setCallOutcome(e.target.value as NonNullable<BookInteraction['outcome']>)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="positive">Good</option><option value="neutral">Okay</option><option value="negative">Hard</option>
            </select>
          </Label>
          <Label className="space-y-1">Private note (optional)
            <Input value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder="Only you can see this" />
          </Label>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void logCall()}>Add call to book</Button>
      </section>

      {currentNudges.length > 0 && <section className="space-y-3 border-t pt-4" aria-labelledby={`nudges-${pair.pairId}`}>
        <h4 id={`nudges-${pair.pairId}`} className="text-sm font-medium">Recent nudges</h4>
        {currentNudges.map((nudge) => <div key={nudge.id} className="space-y-2 rounded-md border bg-background p-3">
          <p className="text-sm">{NUDGE_TEMPLATE_COPY[nudge.templateId]}</p>
          {feedbackIds.has(nudge.id) ? <Badge variant="secondary">Feedback saved</Badge> : <div className="flex flex-wrap gap-2">
            <span className="self-center text-xs text-muted-foreground">How did it land?</span>
            {(['positive', 'neutral', 'negative'] as const).map((outcome) => <Button key={outcome} size="sm" variant="ghost" disabled={busy} onClick={() => void saveNudgeFeedback(nudge.id, outcome)}>{OUTCOME_COPY[outcome]}</Button>)}
          </div>}
        </div>)}
        <p className="text-xs text-muted-foreground">Your feedback is saved locally and is not sent to the nudge sender.</p>
      </section>}

      {unlinkedIntros.length > 0 && <section className="space-y-2 border-t pt-4" aria-labelledby={`intro-${pair.pairId}`}>
        <h4 id={`intro-${pair.pairId}`} className="text-sm font-medium">Add an introduction</h4>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Choose an introduction" value={introductionId} onChange={(e) => setIntroductionId(e.target.value)} className="h-9 min-w-48 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Choose one…</option>
            {unlinkedIntros.map((intro) => <option key={intro.introId} value={intro.introId}>{intro.counterpartName ?? 'Unnamed person'} · {intro.status}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={busy || !introductionId} onClick={() => void linkIntroduction()}>Add to this book</Button>
        </div>
        <p className="text-xs text-muted-foreground">You choose which of your introductions belongs here. The link stays on this device.</p>
      </section>}

      <section className="space-y-2 border-t pt-4" aria-labelledby={`timeline-${pair.pairId}`}>
        <h4 id={`timeline-${pair.pairId}`} className="text-sm font-medium">Past interactions</h4>
        {timeline.length === 0 ? <p className="text-xs text-muted-foreground">Your calls, linked introductions and nudge feedback will appear here.</p> : <ol className="space-y-2">
          {timeline.map((item) => {
            const intro = item.kind === 'introduction' ? ownIntros.find((i) => i.introId === item.sourceId) : null;
            const nudge = item.kind === 'nudge_received' ? currentNudges.find((n) => n.id === item.sourceId) : null;
            const title = item.kind === 'call' ? 'Call' : item.kind === 'introduction' ? `Introduction${intro?.counterpartName ? ` · ${intro.counterpartName}` : ''}` : `Nudge${item.templateId ? ` · ${NUDGE_TEMPLATE_COPY[item.templateId]}` : nudge ? ` · ${NUDGE_TEMPLATE_COPY[nudge.templateId]}` : ''}`;
            return <li key={item.interactionId} className="flex items-start justify-between gap-3 rounded-md border bg-background p-3">
              <div className="min-w-0"><p className="text-sm">{title}</p><p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}{item.outcome ? ` · ${OUTCOME_COPY[item.outcome]}` : ''}</p>{item.note && <p className="mt-1 break-words text-xs">{item.note}</p>}</div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void vault.deleteBookInteraction(pair.pairId, item.interactionId).then(refresh).catch(() => setMessage('Interaction could not be removed.'))}>Remove</Button>
            </li>;
          })}
        </ol>}
      </section>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}

export function RelationshipBook({ pair }: { pair: PairView }) {
  const vault = useVault();
  const [open, setOpen] = useState(false);
  if (pair.status !== 'accepted') return null;
  return <div className="border-t pt-3">
    <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Close relationship book' : 'Open relationship book'}</Button>
    {open && (vault.status.kind === 'live' && !vault.locked
      ? <BookContents key={vault.getVersion()} pair={pair} vault={vault} />
      : <p className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">Unlock your local vault to open this private relationship book. The photos and notes are stored on this device.</p>)}
  </div>;
}
