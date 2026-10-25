'use client';

import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { isClerkConfigured } from '@/lib/config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function AccountArea() {
  if (!isClerkConfigured) {
    return <Badge variant="outline">Auth unconfigured</Badge>;
  }
  return (
    // Clerk Core 3 (@clerk/nextjs 7) replaced <SignedIn>/<SignedOut> with <Show when=...>.
    <>
      <Show when="signed-out">
        <div className="flex items-center gap-2">
          <SignInButton mode="modal" forceRedirectUrl="/" signUpForceRedirectUrl="/">
            <Button size="sm" variant="outline">Sign in</Button>
          </SignInButton>
          <SignUpButton mode="modal" forceRedirectUrl="/" signInForceRedirectUrl="/">
            <Button size="sm">Sign up</Button>
          </SignUpButton>
        </div>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
