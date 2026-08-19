// Flat, abstract bust illustration for the demo persona's profile card —
// deliberately not a photo (a fake name paired with a photorealistic face
// reads as a fabricated real person). Just a generic silhouette in the
// app's own accent token, styled to sit inside the same circle the real
// initials fallback uses elsewhere.
export function PersonaAvatar({ size = 56 }: { size?: number }) {
  const dim = `${size / 16}rem`;
  return (
    <svg
      viewBox="0 0 64 64"
      style={{ width: dim, height: dim }}
      className="shrink-0"
      role="img"
      aria-label="Profile avatar"
    >
      <circle cx="32" cy="32" r="32" fill="var(--ed-accent)" opacity="0.15" />
      <circle cx="32" cy="32" r="31.5" fill="none" stroke="var(--ed-accent)" strokeOpacity="0.4" />
      <circle cx="32" cy="25" r="11" fill="var(--ed-accent)" />
      <path d="M10 57c0-13.25 9.85-20 22-20s22 6.75 22 20" fill="var(--ed-accent)" />
    </svg>
  );
}
