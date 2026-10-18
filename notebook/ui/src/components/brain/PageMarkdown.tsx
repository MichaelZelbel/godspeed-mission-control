import { useRef, useState, type ComponentProps, type ElementType, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Button } from "@/components/ui/button";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";
import { cn } from "@/lib/utils";

// Text the owner wrote for the assistant, shown on Godspeed's brain as the document it is: the
// notebook's Markdown renderer (react-markdown with GFM, as the chat uses), set for reading a
// page rather than a chat bubble. A hard-wrapped line is a soft break in Markdown, so prose flows
// on a phone while lists, code and tables keep their shape (16 October 2026: the extra
// instructions were shown reflowed into one blob, "# When the owner..." and list items run together).
// Links and pictures follow the chat's rules (lib/chat-markdown.tsx): a picture becomes a link.
// Its headings sit under the page's own (h2 for a part): # is an h3, ## an h4, and so on.
type P<T extends ElementType> = ComponentProps<T> & { node?: unknown };
const page = (compact: boolean): Components => ({
  ...chatMarkdownComponents,
  h1: ({ node: _n, ...p }: P<"h1">) => <h3 {...p} className={cn("font-display font-bold leading-snug first:mt-0", compact ? "mb-1 mt-3 text-base" : "mb-2 mt-7 text-xl")} />,
  h2: ({ node: _n, ...p }: P<"h2">) => <h4 {...p} className={cn("font-display font-semibold leading-snug first:mt-0", compact ? "mb-1 mt-3 text-sm" : "mb-2 mt-6 text-lg")} />,
  h3: ({ node: _n, ...p }: P<"h3">) => <h5 {...p} className={cn("font-semibold leading-snug first:mt-0", compact ? "mb-1 mt-2 text-sm" : "mb-1.5 mt-5 text-base")} />,
  h4: ({ node: _n, ...p }: P<"h4">) => <h6 {...p} className="mb-1 mt-4 font-semibold leading-snug first:mt-0" />,
  h5: ({ node: _n, ...p }: P<"h5">) => <h6 {...p} className="mb-1 mt-4 font-semibold leading-snug first:mt-0" />,
  h6: ({ node: _n, ...p }: P<"h6">) => <h6 {...p} className="mb-1 mt-4 font-semibold leading-snug first:mt-0" />,
  p: ({ node: _n, ...p }: P<"p">) => <p {...p} className={cn("first:mt-0 last:mb-0", compact ? "my-2" : "my-3")} />,
  ul: ({ node: _n, ...p }: P<"ul">) => <ul {...p} className={cn("list-disc space-y-1.5 pl-6 first:mt-0 last:mb-0", compact ? "my-2" : "my-3")} />,
  ol: ({ node: _n, ...p }: P<"ol">) => <ol {...p} className={cn("list-decimal space-y-1.5 pl-6 first:mt-0 last:mb-0", compact ? "my-2" : "my-3")} />,
  li: ({ node: _n, ...p }: P<"li">) => <li {...p} className="pl-1 [&>ol]:my-1.5 [&>p]:my-1.5 [&>ul]:my-1.5" />,
  blockquote: ({ node: _n, ...p }: P<"blockquote">) => <blockquote {...p} className="my-3 border-l-2 border-border pl-4 text-muted-foreground" />,
  hr: ({ node: _n, ...p }: P<"hr">) => <hr {...p} className="my-6 border-border" />,
  code: ({ node: _n, className, ...p }: P<"code">) => /language-/.test(className ?? "")
    ? <code {...p} className={className} />
    : <code {...p} className="break-words rounded bg-muted px-1 py-0.5 font-mono text-[0.88em]" />,
  // A code block keeps its lines and scrolls sideways instead of breaking the column.
  pre: ({ node: _n, ...p }: P<"pre">) => <pre {...p} className={cn("my-3 max-w-full overflow-x-auto rounded-md bg-muted p-3 font-mono leading-6 [&>code]:bg-transparent [&>code]:p-0", compact ? "text-xs" : "text-sm")} />,
  // A table keeps columns wide enough to read and scrolls sideways in its own box on a phone,
  // rather than squeezing its words into slivers or pushing the page wider.
  table: ({ node: _n, ...p }: P<"table">) => (
    <div className="my-4 max-w-full overflow-x-auto rounded-md border border-border" role="region" aria-label="Table" tabIndex={0}>
      <table {...p} className={cn("w-full min-w-[34rem] border-collapse", compact ? "text-xs" : "text-sm")} />
    </div>
  ),
  thead: ({ node: _n, ...p }: P<"thead">) => <thead {...p} className="bg-muted/60" />,
  th: ({ node: _n, ...p }: P<"th">) => <th {...p} className="border-b border-border px-3 py-2 text-left align-top font-semibold" />,
  td: ({ node: _n, ...p }: P<"td">) => <td {...p} className="border-t border-border px-3 py-2 align-top" />,
});
const PAGE = page(false), COMPACT = page(true);

export function PageMarkdown({ text, compact = false, className }: { text?: string | null; compact?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0 max-w-[65ch] break-words", compact ? "text-sm leading-6" : "text-base leading-7", className)}>
      <ReactMarkdown remarkPlugins={chatMarkdownPlugins} components={compact ? COMPACT : PAGE}>{String(text ?? "")}</ReactMarkdown>
    </div>
  );
}

// A long text shows its first part with a fade and "Show all", so one part does not become a
// wall in front of the next. Decided by length, so it is the same on every screen.
export const LONG_TEXT = 1200;
export function ShowMore({ text, children, label = "Show all" }: { text?: string | null; children: ReactNode; label?: string }) {
  const long = String(text ?? "").length > LONG_TEXT, [all, setAll] = useState(false), top = useRef<HTMLDivElement>(null);
  if (!long) return <>{children}</>;
  return (
    <div ref={top} className="space-y-3">
      <div className={cn("relative", !all && "max-h-[22rem] overflow-hidden")} data-collapsed={!all || undefined}>
        {children}
        {!all && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-card via-card/80 to-transparent" />}
      </div>
      <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-expanded={all}
        onClick={() => { setAll(!all); if (all) top.current?.scrollIntoView({ block: "nearest" }); }}>
        {all ? "Show less" : label}
      </Button>
    </div>
  );
}
