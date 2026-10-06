import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { api, apiUrl } from '../lib/api';
import { GoogleMark } from './GoogleMark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

type AuthStatus = { signedIn: boolean; email: string | null; available: boolean };

// The nav's right edge: who you are when signed in, and the way to sign in
// when not. Sign-in stays optional (docs/auth.md) — the uid cookie is the
// identity, and Google only decides which one is yours. Signing in from an
// onboarded session links THIS account to Google rather than starting a new
// one (GoogleSignInResolver), which is why the link is offered after
// onboarding too: without it, a cleared cookie or a new device loses the
// account for good.
export function AccountMenu({ auth }: { auth: AuthStatus | undefined }) {
  const [signingOut, setSigningOut] = useState(false);

  // Fixed-mode instances (and a failed /auth/me) have nothing to sign into.
  if (!auth?.available) return null;

  if (!auth.signedIn) {
    return (
      <a
        href={apiUrl('/auth/google/start')}
        className="ml-auto shrink-0 inline-flex items-center gap-2 rounded-full border border-border px-4 py-[0.4rem] text-[13px] font-medium text-foreground transition-colors hover:bg-[var(--ed-accent)]/10"
      >
        <GoogleMark size="14" />
        Sign in with Google
      </a>
    );
  }

  const email = auth.email ?? 'Google account';
  const initial = (auth.email?.trim()[0] ?? 'G').toUpperCase();

  async function signOut() {
    setSigningOut(true);
    try {
      await api('/auth/signout', { method: 'POST' });
    } finally {
      // A full load, not a navigate: every cached query belongs to the
      // account just left, and the next request mints a fresh anonymous one.
      window.location.assign('/');
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${email}`}
        className="ml-auto shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-[var(--ed-accent)]/15 text-[13px] font-semibold text-foreground transition-colors hover:bg-[var(--ed-accent)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">Signed in with Google</span>
          <span className="block truncate text-sm text-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
          <LogOut size={14} aria-hidden="true" className="mr-2" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
