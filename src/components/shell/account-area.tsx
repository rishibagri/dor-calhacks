'use client';

import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { isClerkConfigured } from '@/lib/config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function AccountArea() {
  if (!isClerkConfigured) {
    return <Badge variant="outline">Auth unconfigured</Badge>;
  }
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <Button size="sm" variant="outline">Sign in</Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}
