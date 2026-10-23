import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { api, apiUrl } from '../lib/api';
import { GoogleMark } from './GoogleMark';

type AuthStatus = { signedIn: boolean; email: string | null; available: boolean };

// Sign-in is optional (docs/auth.md): the uid cookie is the identity, and
// Google only decides which one is yours. Signing in from an onboarded session
// links THIS account to Google rather than starting a new one
// (GoogleSignInResolver), which is why it is offered after onboarding too:
// without it, a cleared cookie or a new device loses the account for good.

/** The nav's Profile tab icon: the account's initial when signed in, else the given icon. */
export function ProfileTabIcon({ auth, fallback, size }: { auth: AuthStatus | undefined; fallback: React.ReactNode; size: number }) {
  if (!auth?.signedIn) return <>{fallback}</>;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className="shrink-0 inline-flex items-center justify-center rounded-full bg-[var(--ed-accent)]/20 font-semibold leading-none text-foreground"
    >
      {(auth.email?.trim()[0] ?? 'G').toUpperCase()}
    </span>
  );
}

/** "Sign in with Google" as a link to the OAuth start. */
export function SignInWithGoogle({ className }: { className?: string }) {
  return (
    <a
      href={apiUrl('/auth/google/start')}
      className={`shrink-0 inline-flex items-center gap-2 rounded-full border border-border px-4 py-[0.4rem] text-[13px] font-medium text-foreground transition-colors hover:bg-[var(--ed-accent)]/10 ${className ?? ''}`}
    >
      <GoogleMark size="14" />
      Sign in with Google
    </a>
  );
}

/** The Profile page's account block: who is signed in and Sign out, or the way to sign in. */
export function AccountPanel({ auth }: { auth: AuthStatus | undefined }) {
  const [signingOut, setSigningOut] = useState(false);

  // Fixed-mode instances (and a failed /auth/me) have nothing to sign into.
  if (!auth?.available) return null;

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
    <section aria-label="Account" className="mt-8 pt-6 border-t border-[var(--ed-rule)] flex flex-col items-start gap-[0.6rem]">
      {auth.signedIn ? (
        <>
          <span className="text-[0.72rem] text-[var(--ed-ink-faint)]">Signed in with Google</span>
          <span className="max-w-full truncate text-[0.84rem] text-[var(--ed-ink)]">{auth.email ?? 'Google account'}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="inline-flex items-center gap-2 py-[0.45rem] px-[0.9rem] -ml-[0.9rem] rounded-lg text-[0.84rem] font-medium text-[var(--ed-ink-faint)] transition-colors hover:text-[var(--ed-ink)] disabled:opacity-60"
          >
            <LogOut size={15} aria-hidden="true" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </>
      ) : (
        <>
          <span className="text-[0.76rem] text-[var(--ed-ink-faint)] leading-snug">
            Keep this account on any device.
          </span>
          <SignInWithGoogle />
        </>
      )}
    </section>
  );
}
