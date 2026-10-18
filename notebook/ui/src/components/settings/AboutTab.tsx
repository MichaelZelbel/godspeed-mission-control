import { useQuery } from "@tanstack/react-query";
import { GUIDE_URL } from "@/lib/brand";

// Settings, About (18 October 2026): what this installation is, where it keeps your files, whose data
// the food tracker uses, and where the user guide is. The README and the food tracker point here
// ("Settings, About names it and its licence"); until 18 October 2026 this section sat on an older
// Settings page no address opened. Everything it shows comes from the notebook (/api/about,
// core/about.mjs): the version from the notebook's package.json, the release code as the installer
// recorded it, the food table's licence and citation from core/food-table.mjs (D-321 step 5).
export interface AboutInfo {
  name: string;
  version: string;
  release: { code: string; date: string | null; installed_by: "windows" | "computer" | "server" } | null;
  on: "computer" | "server";
  folders: { workspace: string; notes: string; media: string; backups: string };
  food: {
    installed: boolean;
    notice: string | null;
    downloaded_at: string | null;
    table: string;
    publisher: string;
    licence: string;
    licence_url: string;
    citation: string;
    source_url: string;
    packaged: string;
  };
}

const SOURCE_URL = "https://github.com/MichaelZelbel/godspeed-mission-control";
const KNOWN_ISSUES_URL = `${GUIDE_URL}/known-issues`;
const RELEASE_CHECK_URL = `${GUIDE_URL}/update#check-which-release-you-have`;

async function loadAbout(): Promise<AboutInfo> {
  const response = await fetch('/api/about');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
// "18 October 2026", in the reader's own language.
function longDay(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
}
// The Open Food Facts sentence names its address; that address becomes a link.
function withLinks(text: string) {
  return text.split(/(https:\/\/[^\s)]+)/).map((part, i) =>
    /^https:\/\//.test(part) ? <a key={i} className="underline" href={part} target="_blank" rel="noreferrer">{part.replace(/^https:\/\//, "")}</a> : part,
  );
}

function Folder({ label, path }: { label: string; path: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd><code className="text-sm break-all">{path}</code></dd>
    </div>
  );
}

export function AboutTab() {
  const { data, isLoading, error } = useQuery({ queryKey: ["about"], queryFn: loadAbout, staleTime: 60000 });
  const where = data?.on === "server" ? "your server" : "this computer";
  return (
    <section id="about" className="border rounded p-4 space-y-5">
      <h2 className="text-xl">About</h2>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p role="alert" className="text-sm text-destructive">The details of this installation could not be loaded. Reload the page to try again.</p>}

      {data && (
        <>
          <div className="space-y-2">
            <h3 className="text-base font-semibold">Godspeed Mission Control</h3>
            <dl className="space-y-2">
              <div className="space-y-0.5">
                <dt className="text-sm text-muted-foreground">Version</dt>
                <dd>{data.version}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-sm text-muted-foreground">Release code</dt>
                <dd>
                  {data.release ? (
                    <>
                      <code className="text-sm break-all">{data.release.code}</code>
                      {data.release.date && <span className="text-sm"> (from {longDay(data.release.date)})</span>}
                    </>
                  ) : (
                    <span className="text-sm">Not recorded. This copy was not set up by one of the installers.</span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="text-sm">
              <a className="underline" href={RELEASE_CHECK_URL} target="_blank" rel="noreferrer">How to check whether a newer release is out</a>
            </p>
            <p className="text-sm text-muted-foreground">
              Godspeed Mission Control is open source. Its code is under the MIT licence; the notebook's screens, which come
              from the Menerio notebook, are under the AGPL-3.0 licence.{" "}
              <a className="underline" href={SOURCE_URL} target="_blank" rel="noreferrer">See the code on GitHub</a>.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-semibold">Where your files are</h3>
            {data.on === "server" && <p className="text-sm text-muted-foreground">These folders are on your server.</p>}
            <dl className="space-y-2">
              <Folder label="Your mission control folder" path={data.folders.workspace} />
              <Folder label="Your notes" path={data.folders.notes} />
              <Folder label="Photos and files you added" path={data.folders.media} />
              <Folder label="Backups" path={data.folders.backups} />
            </dl>
          </div>

          <div className="space-y-2 text-sm">
            <h3 className="text-base font-semibold">Food values</h3>
            <p>
              The food tracker's calories and nutrients come from the German food table {data.food.table}, published by
              the {data.food.publisher} under the licence{" "}
              <a className="underline" href={data.food.licence_url} target="_blank" rel="noreferrer">{data.food.licence}</a>.
              Your mission control downloads it once from{" "}
              <a className="underline" href={data.food.source_url} target="_blank" rel="noreferrer">blsdb.de</a>{" "}
              and works offline after that. It keeps only the energy and nutrient columns the tracker uses.
            </p>
            <p>
              {data.food.installed
                ? <>The food table is on {where}{data.food.downloaded_at ? <>, downloaded on {longDay(data.food.downloaded_at)}</> : null}. Its licence notice is in <code className="break-all">{data.food.notice}</code>.</>
                : <>The food table is not on {where} yet. The notebook downloads it by itself shortly after it starts, when the internet can be reached.</>}
            </p>
            <p className="text-muted-foreground">Citation: {data.food.citation}</p>
            <p>{withLinks(data.food.packaged)}</p>
            <p className="text-muted-foreground">The numbers are estimates from these tables. You can change every entry in your notebook.</p>
          </div>
        </>
      )}

      <div className="space-y-1 text-sm">
        <h3 className="text-base font-semibold">Help</h3>
        <p>
          The user guide explains every part of Godspeed Mission Control:{" "}
          <a className="underline" href={GUIDE_URL} target="_blank" rel="noreferrer">godspeedmissioncontrol.com/guide</a>.
        </p>
        <p>
          What does not work yet, and what to do instead:{" "}
          <a className="underline" href={KNOWN_ISSUES_URL} target="_blank" rel="noreferrer">Known issues</a>.
        </p>
      </div>
    </section>
  );
}
