'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useVault } from '@/lib/backend';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MultiChoice, Question, SingleChoice } from '@/components/feature/quiz-fields';
import { Input } from '@/components/ui/input';
import {
  ACTIVITY_LABELS, CATEGORY_LABELS, EMPTY_ANSWERS, LONG_DAY_LABELS, QUESTION_COUNT, buildProfile,
  buildQuizExtras, countAnswered, toggle, type LongDayChoice, type QuizAnswers, type SupportMode,
} from '@/components/feature/quiz-model';
import type { SharingCategory } from '@kinetic/contracts';
import type { ConnectActivity } from '@/lib/backend/ports';

const longDayOptions = (Object.keys(LONG_DAY_LABELS) as LongDayChoice[]).map((v) => ({ value: v, label: LONG_DAY_LABELS[v] }));
const activityOptions = (Object.keys(ACTIVITY_LABELS) as ConnectActivity[]).map((v) => ({ value: v, label: ACTIVITY_LABELS[v] }));
const categoryOptions = (Object.keys(CATEGORY_LABELS) as SharingCategory[]).map((v) => ({ value: v, label: CATEGORY_LABELS[v] }));
const quietOptions: { value: SupportMode; label: string }[] = [
  { value: 'encouraging_note', label: 'A light check-in note' },
  { value: 'shared_activity', label: 'An invitation to do something' },
];
const scheduleOptions = [
  { value: 'only_after_review' as const, label: 'Only suggest times after I review them' },
  { value: 'keep_private' as const, label: 'Keep my schedule out of suggestions' },
];
const reviewOptions = [
  { value: 'review_everything' as const, label: 'Show me everything in detail' },
  { value: 'quick_review' as const, label: 'A quick summary is enough' },
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
      await vault.saveQuizExtras(buildQuizExtras(a));
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
        <p className="text-sm text-muted-foreground" aria-live="polite">{answered} of {QUESTION_COUNT} answered</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={QUESTION_COUNT} aria-valuenow={answered}>
          <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            style={{ transform: `scaleX(${answered / QUESTION_COUNT})` }} />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Eight optional questions</CardTitle>
          <CardDescription>Leave any blank. Answers stay in this tab&apos;s memory unless saved to the local vault.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Question legend="1. After a long day, what helps?" hint="Choosing space means Kinetic suggests nothing for that moment.">
            <MultiChoice name="q1" options={longDayOptions} value={a.afterLongDay}
              onChange={(v, on) => set({ afterLongDay: toggle(a.afterLongDay, v, on) })} />
          </Question>
          <Question legend="2. When a friend goes quiet, what do you prefer?">
            <MultiChoice name="q2" options={quietOptions} value={a.friendQuiet}
              onChange={(v, on) => set({ friendQuiet: toggle(a.friendQuiet, v, on) })} />
          </Question>
          <Question legend="3. Which tone and rhythm feel right?">
            <SingleChoice name="q3-tone" value={a.tone} onChange={(tone) => set({ tone })}
              options={[{ value: 'direct', label: 'Direct' }, { value: 'gentle', label: 'Gentle' }, { value: 'playful', label: 'Playful' }]} />
            <SingleChoice name="q3-rhythm" value={a.rhythm} onChange={(rhythm) => set({ rhythm })}
              options={[{ value: 'spontaneous', label: 'Spontaneous' }, { value: 'planned', label: 'Planned' }, { value: 'flexible', label: 'Flexible' }]} />
          </Question>
          <Question legend="4. When overwhelmed, how should suggestions behave?">
            <SingleChoice name="q4" value={a.overwhelmed} onChange={(overwhelmed) => set({ overwhelmed })}
              options={[{ value: 'fewer', label: 'Fewer' }, { value: 'quiet', label: 'Quieter' }, { value: 'paused', label: 'Paused' }]} />
          </Question>
          <Question legend="5. Which activities make connecting easy?" hint="Stays in your local vault only.">
            <MultiChoice name="q5" options={activityOptions} value={a.activities}
              onChange={(v, on) => set({ activities: toggle(a.activities, v, on) })} />
            {a.activities.includes('other') && (
              <Input aria-label="Other activity" maxLength={200} value={a.activitiesNote}
                placeholder="Anything else (kept local)" onChange={(e) => set({ activitiesNote: e.target.value })} />
            )}
          </Question>
          <Question legend="6. How should the app approach schedule suggestions?">
            <SingleChoice name="q6" value={a.scheduleSuggestions} options={scheduleOptions}
              onChange={(scheduleSuggestions) => set({ scheduleSuggestions })} />
          </Question>
          <Question legend="7. Which categories might you consider sharing? (nominates drafts only)">
            <MultiChoice name="q7" options={categoryOptions} value={a.categories}
              onChange={(v, on) => set({ categories: toggle(a.categories, v, on) })} />
          </Question>
          <Question legend="8. Before connecting someone, how much review feels comfortable?"
            hint="Either way, you still approve each item before anything is shared.">
            <SingleChoice name="q8" value={a.reviewComfort} options={reviewOptions}
              onChange={(reviewComfort) => set({ reviewComfort })} />
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
