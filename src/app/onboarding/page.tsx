'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useVault } from '@/lib/backend';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MultiChoice, Question, SingleChoice } from '@/components/feature/quiz-fields';
import {
  CATEGORY_LABELS, EMPTY_ANSWERS, SUPPORT_LABELS, buildProfile, countAnswered, toggle,
  type QuizAnswers, type SupportMode,
} from '@/components/feature/quiz-model';
import type { SharingCategory } from '@kinetic/contracts';

const supportOptions = (Object.keys(SUPPORT_LABELS) as SupportMode[]).map((v) => ({ value: v, label: SUPPORT_LABELS[v] }));
const categoryOptions = (Object.keys(CATEGORY_LABELS) as SharingCategory[]).map((v) => ({ value: v, label: CATEGORY_LABELS[v] }));
const quietOptions: { value: SupportMode; label: string }[] = [
  { value: 'encouraging_note', label: 'A light check-in note' },
  { value: 'shared_activity', label: 'An invitation to do something' },
];

export default function OnboardingPage() {
  const vault = useVault();
  const [a, setA] = useState<QuizAnswers>(EMPTY_ANSWERS);
  const [message, setMessage] = useState<string | null>(null);
  const answered = countAnswered(a);
  const vaultReady = vault.status.kind === 'live' && !vault.locked;
  const set = (patch: Partial<QuizAnswers>) => setA((prev) => ({ ...prev, ...patch }));

  async function save() {
    const parsed = buildProfile(a);
    if (!parsed.success) { setMessage(`Invalid profile: ${parsed.error.message}`); return; }
    try {
      await vault.saveProfile(parsed.data);
      setMessage('Saved to your local vault.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save profile.');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">How do you connect?</h1>
          <p className="max-w-prose text-muted-foreground">
            A few gentle questions. All optional, and you can leave any blank.
          </p>
        </div>
        <Button asChild variant="ghost" className="shrink-0"><Link href="/journal">Skip</Link></Button>
      </header>
      <Alert className="border-primary/40">
        <AlertTitle>Answers never grant sharing</AlertTitle>
        <AlertDescription className="text-pretty">
          This quiz is optional and only suggests draft settings. Skipping or answering shares nothing; you
          confirm presets and approve each signal separately. Answers describe preferences, not a personality type.
        </AlertDescription>
      </Alert>
      <div className="space-y-2" role="group" aria-label="Quiz progress">
        <p className="text-sm text-muted-foreground" aria-live="polite">{answered} of 6 answered</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={6} aria-valuenow={answered}>
          <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            style={{ transform: `scaleX(${answered / 6})` }} />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Six optional questions</CardTitle>
          <CardDescription>Leave any blank. Answers stay in this tab&apos;s memory unless saved to the local vault.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Question legend="1. After a long day, what helps?">
            <MultiChoice name="q1" options={supportOptions} value={a.afterLongDay}
              onChange={(v, on) => set({ afterLongDay: toggle(a.afterLongDay, v, on) })} />
          </Question>
          <Question legend="2. When a friend goes quiet, what do you prefer?">
            <MultiChoice name="q2" options={quietOptions} value={a.friendQuiet}
              onChange={(v, on) => set({ friendQuiet: toggle(a.friendQuiet, v, on) })} />
          </Question>
          <Question legend="3. Which tone feels right?">
            <SingleChoice name="q3" value={a.tone} onChange={(tone) => set({ tone })}
              options={[{ value: 'direct', label: 'Direct' }, { value: 'gentle', label: 'Gentle' }, { value: 'playful', label: 'Playful' }]} />
          </Question>
          <Question legend="4. Which rhythm feels right?">
            <SingleChoice name="q4" value={a.rhythm} onChange={(rhythm) => set({ rhythm })}
              options={[{ value: 'spontaneous', label: 'Spontaneous' }, { value: 'planned', label: 'Planned' }, { value: 'flexible', label: 'Flexible' }]} />
          </Question>
          <Question legend="5. When overwhelmed, how should suggestions behave?">
            <SingleChoice name="q5" value={a.overwhelmed} onChange={(overwhelmed) => set({ overwhelmed })}
              options={[{ value: 'fewer', label: 'Fewer' }, { value: 'quiet', label: 'Quieter' }, { value: 'paused', label: 'Paused' }]} />
          </Question>
          <Question legend="6. Which categories might you consider sharing? (nominates drafts only)">
            <MultiChoice name="q6" options={categoryOptions} value={a.categories}
              onChange={(v, on) => set({ categories: toggle(a.categories, v, on) })} />
          </Question>
        </CardContent>
      </Card>
      {!vaultReady && (
        <Alert><AlertTitle>Vault pending (Cyber)</AlertTitle>
          <AlertDescription>Saving is disabled; answers stay in memory only and are lost on reload.</AlertDescription></Alert>
      )}
      {message && <p role="status" className="text-sm text-foreground">{message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!vaultReady}>Save profile locally</Button>
        <Button asChild variant="ghost"><Link href="/journal">Skip</Link></Button>
      </div>
    </div>
  );
}
