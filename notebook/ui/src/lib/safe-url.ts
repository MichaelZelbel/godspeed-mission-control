/**
 * URLs that came from stored data (a note's source_url, a collection field, an
 * embed's src) are written by more than the signed-in user: connected apps,
 * Mission Control API keys, capture bots and the AI all write notes. A
 * `javascript:` URL in any of them runs in this app's origin the moment it is
 * opened, with the session in reach. React 18 still renders such an href, and
 * `window.open` and an iframe `src` execute it, so every sink checks here.
 *
 * Parsed with `URL`, not matched as text: the parser drops the tabs, newlines
 * and leading spaces that `java\tscript:` hides behind, exactly as the browser
 * would before running it.
 */

const DANGEROUS_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:", "blob:", "file:"]);

/**
 * The URL, trimmed, when it is safe to open in a new tab or use as a link;
 * otherwise null. Custom app schemes (obsidian://, notion://) pass, since
 * connected apps link back to themselves that way.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (DANGEROUS_PROTOCOLS.has(parsed.protocol)) return null;
  return value;
}

/**
 * The src for an embedded frame or media element: http(s) only, anything else
 * becomes about:blank. Stricter than safeExternalUrl because a frame loads
 * without a click.
 *
 * A note's own attachments are served from this app at a relative URL
 * (`/api/media/file/...`), so a relative URL that stays on this origin is
 * allowed too; until 7 October 2026 only an absolute http(s) URL passed, and
 * every note PDF, video and audio embed rendered blank. A protocol-relative
 * `//other.example` resolves off-site and is still refused.
 */
export function safeEmbedSrc(raw: unknown): string {
  if (typeof raw !== "string") return "about:blank";
  const value = raw.trim();
  if (value === "about:blank") return value;
  const origin = typeof location !== "undefined" ? location.origin : null;
  let parsed: URL;
  try {
    parsed = new URL(value, origin ?? undefined);
  } catch {
    return "about:blank";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "about:blank";
  // An absolute http(s) URL the author wrote in full keeps working; a relative
  // URL only when it resolves to this app's own origin.
  if (/^https?:\/\//i.test(value)) return value;
  return origin && parsed.origin === origin ? value : "about:blank";
}

/** Open a stored URL in a new tab, or do nothing when it is not safe to. */
export function openExternalUrl(raw: unknown): void {
  const url = safeExternalUrl(raw);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
