import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface JobDescriptionTextProps {
  text: string;
}

// Scraped job descriptions arrive as real (if messy) Markdown — **bold**
// section headers, `*`-bullet lists, backslash-escaped punctuation, and long
// runs of near-blank lines from the source HTML's empty paragraphs. Rendering
// that verbatim in a <pre> (the old approach) shows literal asterisks and
// backslashes and irregular gaps — this actually parses it, so headers/lists
// render as headers/lists and CommonMark collapses the blank-line noise into
// normal paragraph spacing on its own.
export function JobDescriptionText({ text }: JobDescriptionTextProps) {
  return (
    <div dir="auto" className="text-[16px] leading-[1.7] text-[var(--ed-ink-soft)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-4">{children}</p>,
          strong: ({ children }) => <strong className="text-[var(--ed-ink)] font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="mb-4 flex flex-col gap-[0.5rem]">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 flex flex-col gap-[0.5rem] list-decimal list-inside marker:text-[var(--ed-ink-faint)]">{children}</ol>,
          li: ({ children, ...props }) => {
            const ordered = 'ordered' in props && props.ordered;
            if (ordered) return <li>{children}</li>;
            return (
              <li className="flex gap-[0.65rem]">
                <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[var(--ed-accent)] mt-[0.7em]" aria-hidden="true" />
                <span>{children}</span>
              </li>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--ed-accent)] underline underline-offset-2 decoration-[var(--ed-rule-strong)] hover:text-[var(--ed-accent-deep)]"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h3 className="text-[var(--ed-ink)] font-semibold text-[1.05em] mt-6 mb-2">{children}</h3>,
          h2: ({ children }) => <h3 className="text-[var(--ed-ink)] font-semibold text-[1.05em] mt-6 mb-2">{children}</h3>,
          h3: ({ children }) => <h3 className="text-[var(--ed-ink)] font-semibold text-[1.05em] mt-6 mb-2">{children}</h3>,
          h4: ({ children }) => <h3 className="text-[var(--ed-ink)] font-semibold text-[1.05em] mt-6 mb-2">{children}</h3>,
          hr: () => <hr className="my-6 border-[var(--ed-rule)]" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
