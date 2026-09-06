import { Fragment } from 'react';

// Renders text that may mix Hebrew and Latin-script technical terms.
//
// The problem: AI-translated/generated Hebrew narrative deliberately keeps
// technical terms untranslated in Latin script (see
// PromptSeeds.TranslateMatchAnalysis / PromptSeeds.WhyWorkHere —
// "Kubernetes", "CI/CD", ".NET", company names, etc.). With only dir="auto"
// on the container, the browser's bidi algorithm treats neutral characters
// (commas, hyphens, parentheses) right at the Hebrew/Latin boundary as
// belonging to whichever side "wins" contextually, which can visually
// reorder them in a way a reader finds scrambled — e.g. a Hebrew "vav-
// hyphen" (and-) prefix or a list's punctuation landing on the wrong side
// of the English term it's attached to.
//
// A first attempt embedded Unicode isolate control characters (LRI/PDI)
// directly into the text string, and a second attempt wrapped whole
// segments (including their leading/trailing spaces) in <bdi>. Both
// collapsed the space sitting right at the Hebrew/Latin boundary to zero
// width — a known bidi rendering quirk: whitespace at the very edge of an
// isolated run, adjacent to a direction change, can render invisibly.
// Fix: keep boundary whitespace OUTSIDE the isolate as plain text (it
// renders fine there, same as it did with no isolation at all — see the
// original bug this was chasing), and only wrap the trimmed word content
// itself in <bdi>.
//
// Pure-Hebrew or pure-Latin text renders as a single plain text node
// (no Hebrew present = nothing to isolate against).
const HEBREW_CHAR = /[֐-׿]/;
const HEBREW_RUN_SPLIT = /([֐-׿]+)/;
const LATIN_LETTER = /[A-Za-z]/;
// Captures a segment's leading whitespace, core content, and trailing
// whitespace, so the core alone can be isolated while the whitespace stays
// outside it. `[\s\S]*?` (not `.*?`) so it still matches across a stray
// newline inside a segment.
const TRIM_CAPTURE = /^(\s*)([\s\S]*?)(\s*)$/;

export function BidiText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  if (!HEBREW_CHAR.test(text)) return <>{text}</>;
  return (
    <>
      {text.split(HEBREW_RUN_SPLIT).map((segment, i) => {
        if (!LATIN_LETTER.test(segment)) return <Fragment key={i}>{segment}</Fragment>;
        const [, lead, core, trail] = segment.match(TRIM_CAPTURE)!;
        return <Fragment key={i}>{lead}<bdi>{core}</bdi>{trail}</Fragment>;
      })}
    </>
  );
}
