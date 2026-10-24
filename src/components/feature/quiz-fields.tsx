'use client';

import type { ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const ROW =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2 ' +
  'transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ' +
  '[@media(hover:hover)]:hover:bg-muted active:scale-[0.99] has-[[data-state=checked]]:border-border ' +
  'has-[[data-state=checked]]:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100';

export function Question({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <legend className="text-base font-medium leading-snug">{legend}</legend>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {children}
    </fieldset>
  );
}

interface Option<T extends string> { value: T; label: string }

export function MultiChoice<T extends string>(props: {
  name: string; options: Option<T>[]; value: T[]; onChange: (next: T, on: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      {props.options.map((o) => {
        const id = `${props.name}-${o.value}`;
        return (
          <Label key={o.value} htmlFor={id} className={ROW}>
            <Checkbox id={id} checked={props.value.includes(o.value)}
              onCheckedChange={(c) => props.onChange(o.value, c === true)} />
            <span className="font-normal">{o.label}</span>
          </Label>
        );
      })}
    </div>
  );
}

export function SingleChoice<T extends string>(props: {
  name: string; options: Option<T>[]; value: T | null; onChange: (next: T | null) => void;
}) {
  const idFor = (v: string) => (v === 'none' ? `${props.name}-none` : `${props.name}-${v}`);
  return (
    <RadioGroup value={props.value ?? 'none'} aria-label={props.name} className="gap-1"
      onValueChange={(v) => props.onChange(v === 'none' ? null : (v as T))}>
      {[...props.options, { value: 'none' as T, label: 'No preference / skip' }].map((o) => (
        <Label key={o.value} htmlFor={idFor(o.value)}
          className={`${ROW} ${o.value === 'none' ? 'text-muted-foreground' : ''}`}>
          <RadioGroupItem id={idFor(o.value)} value={o.value} />
          <span className="font-normal">{o.label}</span>
        </Label>
      ))}
    </RadioGroup>
  );
}
