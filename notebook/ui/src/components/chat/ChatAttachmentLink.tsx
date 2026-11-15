import { keptElsewhereMessage, useMediaPresence } from "@/lib/media-presence";

export function ChatAttachmentLink({ file }: { file: { path: string; name: string } }) {
  const { data } = useMediaPresence([file.path]);
  if (data?.[file.path] === "kept_elsewhere") {
    return <span className="block text-xs mt-2 text-muted-foreground">{file.name}: {keptElsewhereMessage}</span>;
  }
  if (data?.[file.path] !== "present") return <span className="block text-xs mt-2 text-muted-foreground">{file.name}</span>;
  return <a className="block text-xs underline mt-2" href={`/api/media/file/${encodeURIComponent(file.path)}`} target="_blank" rel="noreferrer">{file.name}</a>;
}
