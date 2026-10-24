'use client';

/**
 * Drop-in privacy controls for the device journal vault (Cyber, CYBER-R1). CS composes it into a page and
 * passes the per-account LocalVault (see README.md). Secrets live only in uncontrolled inputs read on submit;
 * they are never put in React state, storage, logs or URLs.
 */
import { useEffect, useMemo, useReducer, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DESTROY_CONFIRMATION, MIN_PASSPHRASE, VaultControlsController, type VaultControlsPort } from './vault-controller';

function Secret({ name, label, autoComplete }: { name: string; label: string; autoComplete: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="password" autoComplete={autoComplete} spellCheck={false} required />
    </div>
  );
}

/** Reads named fields from the submitted form, then clears every input so secrets don't linger in the DOM. */
function fields(e: FormEvent<HTMLFormElement>, ...names: string[]): string[] {
  e.preventDefault();
  const form = e.currentTarget;
  const values = names.map((n) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '');
  form.reset();
  return values;
}

function Form({ onSubmit, children, submit, busy, extra }: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void; children: ReactNode; submit: string; busy: boolean; extra?: ReactNode;
}) {
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Working…' : submit}</Button>
        {extra}
      </div>
    </form>
  );
}

export function VaultControls({ vault }: { vault: VaultControlsPort }) {
  const controller = useMemo(() => new VaultControlsController(vault), [vault]);
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const v = controller.snapshot();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // start() is idempotent (re-subscribes, refreshes), so StrictMode's mount/unmount/mount is safe.
  useEffect(() => { void controller.start(); return () => controller.stop(); }, [controller]);
  // Re-enable the unlock button when the backoff ends.
  useEffect(() => {
    if (v.retryInMs <= 0) return;
    const t = setTimeout(rerender, v.retryInMs);
    return () => clearTimeout(t);
  }, [v.retryInMs]);

  const secondary = (label: string, onClick: () => void) => (
    <Button type="button" variant="outline" onClick={onClick} disabled={v.busy}>{label}</Button>
  );

  let body: ReactNode = null;
  switch (v.screen) {
    case 'loading':
      body = <p className="text-sm text-muted-foreground">Checking this device…</p>;
      break;
    case 'unavailable':
      body = null;
      break;
    case 'create':
      body = (
        <Form busy={v.busy} submit="Create encrypted journal"
          onSubmit={(e) => { const [p, c] = fields(e, 'new-pass', 'new-pass-confirm'); void controller.create(p, c); }}>
          <p className="text-sm text-muted-foreground">
            Your journal is encrypted on this device with a passphrase of at least {MIN_PASSPHRASE} characters.
            If you lose both your passphrase and recovery code, your journal cannot be recovered. Signing in does not restore it.
          </p>
          <Secret name="new-pass" label="Passphrase" autoComplete="new-password" />
          <Secret name="new-pass-confirm" label="Confirm passphrase" autoComplete="new-password" />
        </Form>
      );
      break;
    case 'confirm_recovery':
      body = (
        <form className="grid gap-4" onSubmit={(e) => { const [g] = fields(e, 'recovery-last'); controller.acknowledgeRecovery(g); }}>
          <p className="text-sm">Write this recovery code down and keep it somewhere safe. It is shown only once.</p>
          <code className="select-all rounded-md border bg-muted px-3 py-2 font-mono text-sm tracking-wider break-all">{v.recoveryCode}</code>
          <div className="grid gap-1.5">
            <Label htmlFor="recovery-last">Type the last group to confirm you saved it</Label>
            <Input id="recovery-last" name="recovery-last" autoComplete="off" spellCheck={false} required maxLength={4} />
          </div>
          <div><Button type="submit">I saved it</Button></div>
        </form>
      );
      break;
    case 'unlock':
      body = (
        <Form busy={v.busy || v.retryInMs > 0} submit="Unlock"
          onSubmit={(e) => { const [p] = fields(e, 'unlock-pass'); void controller.unlock(p); }}
          extra={<>{secondary('Use recovery code', () => controller.showRecover())}{secondary('Delete journal', () => controller.showDestroy())}</>}>
          <Secret name="unlock-pass" label="Passphrase" autoComplete="current-password" />
        </Form>
      );
      break;
    case 'recover':
      body = (
        <Form busy={v.busy || v.retryInMs > 0} submit="Recover and set new passphrase"
          onSubmit={(e) => { const [r, p, c] = fields(e, 'recovery-code', 'recover-pass', 'recover-pass-confirm'); void controller.recover(r, p, c); }}
          extra={secondary('Cancel', () => controller.cancel())}>
          <Secret name="recovery-code" label="Recovery code" autoComplete="off" />
          <Secret name="recover-pass" label="New passphrase" autoComplete="new-password" />
          <Secret name="recover-pass-confirm" label="Confirm new passphrase" autoComplete="new-password" />
        </Form>
      );
      break;
    case 'unlocked':
      body = (
        <div className="grid gap-3">
          <p className="text-sm">Unlocked on this device. It locks after 15 minutes idle or when you leave the page.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => controller.lock()}>Lock now</Button>
            {secondary('Change passphrase', () => controller.showChangePassphrase())}
            {secondary('Delete journal', () => controller.showDestroy())}
          </div>
        </div>
      );
      break;
    case 'change_passphrase':
      body = (
        <Form busy={v.busy} submit="Change passphrase"
          onSubmit={(e) => { const [cur, n, c] = fields(e, 'cur-pass', 'next-pass', 'next-pass-confirm'); void controller.changePassphrase(cur, n, c); }}
          extra={secondary('Cancel', () => controller.cancel())}>
          <Secret name="cur-pass" label="Current passphrase" autoComplete="current-password" />
          <Secret name="next-pass" label="New passphrase" autoComplete="new-password" />
          <Secret name="next-pass-confirm" label="Confirm new passphrase" autoComplete="new-password" />
        </Form>
      );
      break;
    case 'confirm_destroy':
      body = (
        <form className="grid gap-4" onSubmit={(e) => { const [t] = fields(e, 'destroy-confirm'); void controller.destroy(t); }}>
          <p className="text-sm">
            This permanently deletes the encrypted journal, reflections and private quiz answers on this device.
            It cannot be undone and signing in will not restore them. Shared approvals are managed separately.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="destroy-confirm">Type {DESTROY_CONFIRMATION} to confirm</Label>
            <Input id="destroy-confirm" name="destroy-confirm" autoComplete="off" required />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={v.busy}>Delete permanently</Button>
            {secondary('Cancel', () => controller.cancel())}
          </div>
        </form>
      );
      break;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Private journal on this device</CardTitle>
        <CardDescription>
          Encrypted at rest in this browser. It is not end-to-end encrypted processing: text you choose to reflect on is
          sent to the AI provider for that request.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {v.error && <Alert variant="destructive" role="alert"><AlertDescription>{v.error}</AlertDescription></Alert>}
        {v.notice && <Alert role="status"><AlertDescription>{v.notice}</AlertDescription></Alert>}
        {body}
      </CardContent>
    </Card>
  );
}
