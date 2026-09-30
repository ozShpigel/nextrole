// Google's "G" — used on the nav's sign-in link and the Landing company tiles.
export function GoogleMark({ size = '100%' }: { size?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.14-3.13-.4-4.6H24v9h11.8c-.5 2.7-2.05 5-4.35 6.55v5.4h7c4.1-3.78 6.45-9.36 6.45-16.35z" />
      <path fill="#34A853" d="M24 46c5.85 0 10.75-1.94 14.35-5.25l-7-5.4c-1.94 1.3-4.45 2.07-7.35 2.07-5.65 0-10.44-3.81-12.15-8.94H4.6v5.57C8.2 41.1 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.85 28.48A13.98 13.98 0 0 1 11.1 24c0-1.56.27-3.07.75-4.48v-5.57H4.6A21.98 21.98 0 0 0 2 24c0 3.55.85 6.9 2.6 9.86l7.25-5.38z" />
      <path fill="#EA4335" d="M24 10.75c3.18 0 6.03 1.1 8.28 3.24l6.2-6.2C34.72 4.18 29.82 2 24 2 15.5 2 8.2 6.9 4.6 14.14l7.25 5.57c1.7-5.13 6.5-8.96 12.15-8.96z" />
    </svg>
  );
}
