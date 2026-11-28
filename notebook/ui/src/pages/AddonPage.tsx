import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { Skeleton } from "@/components/ui/skeleton";
import { AddonPart, type Api, type Part } from "@/components/addons/AddonParts";
import { addonPagePath, useAddonMenus } from "@/lib/addon-pages";

// An add-on's page in the notebook (/dashboard/addons/<id>/<page>; core/addon-notebook.mjs, #1182).
// The add-on says what is on it as data; the notebook draws it with its own components.
type Page = { id: string; title: string; parts: Part[] };
const toApi = (id: string) => `/api/addons/${id}`;

async function send(route: string, body?: unknown) {
  const r = await fetch(route, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data };
}

export default function AddonPage() {
  const { id = "", page: pageId } = useParams();
  const menus = useAddonMenus();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const first = menus.find((m) => m.id === id)?.pages[0]?.id;

  useEffect(() => {
    if (!pageId) return;
    let live = true;
    setError("");
    void send(`${toApi(id)}/pages/${pageId}`).then((r) => { if (!live) return; if (r.ok) setPage(r.data); else { setPage(null); setError(r.data.error || "That page is not there."); } }).catch(() => { if (live) setError("That page could not be loaded."); });
    return () => { live = false; };
  }, [id, pageId, version]);

  const api: Api = useMemo(() => ({
    save: async (part, value, base) => {
      const r = await send(`${toApi(id)}/field`, { page: pageId, part, value, base });
      if (r.status === 409) return { state: "conflict", current: r.data.current };
      if (!r.ok) throw new Error(r.data.error || "This could not be saved.");
      return { state: "saved", value: r.data.value };
    },
    act: async (part, input) => {
      const r = await send(`${toApi(id)}/action`, { page: pageId, part, input });
      if (!r.ok) throw new Error(r.data.error || "That did not work.");
      if (r.data.refresh) setVersion((v) => v + 1);
      return r.data;
    },
    job: async (job) => { const r = await send(`${toApi(id)}/job/${encodeURIComponent(job)}`); if (!r.ok) throw new Error(r.data.error || "That did not work."); return r.data; },
  }), [id, pageId]);

  if (!pageId) return first ? <Navigate to={addonPagePath(id, first)} replace /> : <p className="p-6 text-muted-foreground">Looking for this add-on's pages…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <SEOHead title={page?.title || "Add-on"} />
      {error ? <p role="alert" className="text-muted-foreground">{error}</p>
        : !page ? <Skeleton className="h-40 w-full" />
        : (<>
          <h1 className="font-display text-2xl">{page.title}</h1>
          {page.parts.map((part, i) => <AddonPart key={`${page.id}-${part.id ?? i}`} part={part} api={api} />)}
        </>)}
    </div>
  );
}
