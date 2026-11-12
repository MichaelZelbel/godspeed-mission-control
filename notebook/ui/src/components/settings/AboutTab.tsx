import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

// The newest release and how this installation takes it (/api/update, core/update.mjs): the Update now
// button where the notebook can update itself, the line to run where it cannot (a Docker server, or a
// computer whose installation came before the button). `automatic` is the choice to update automatically
// (core/automatic-update.mjs, #458), offered only where the notebook can update itself.
type UpdateState = "checking" | "downloading" | "preparing" | "switching" | "updated" | "failed";
export interface UpdateInfo {
  installed: string;
  newest: { tag: string; version: string; notes: string } | null;
  newer: boolean;
  way: "windows" | "server" | "handover" | "terminal" | "none";
  command: string | null;
  busy: boolean;
  status: { state: UpdateState; from: string; to: string; message: string; at: string } | null;
  error: string | null;
  automatic?: AutomaticInfo;
}
export interface AutomaticInfo {
  offered: boolean;
  reason: string | null;
  choice: "automatic" | "myself";
  time: string;
  paused: { until: string | null } | null;
  last: { day: string; result: string; to: string | null; message: string | null } | null;
}
const RUNNING: UpdateState[] = ["checking", "downloading", "preparing", "switching"];

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

async function loadUpdate(): Promise<UpdateInfo> {
  const response = await fetch('/api/update');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function UpdateBlock() {
  const client = useQueryClient();
  // When the button was answered: the status this update ends with is written after it. One an earlier
  // update left (failed, or updated) must not end this one before its first status arrives.
  const [asked, setAsked] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ["update"], queryFn: loadUpdate, staleTime: 60000, retry: false,
    // While an update runs the notebook restarts, and every question fails until the new one answers.
    refetchInterval: query => (asked !== null || query.state.data?.busy || RUNNING.includes(query.state.data?.status?.state as UpdateState) ? 3000 : false),
  });
  const status = data?.status;
  const running = asked !== null || !!data?.busy || (!!status && RUNNING.includes(status.state));
  if (asked !== null && data && !data.busy && status && !RUNNING.includes(status.state) && status.at >= asked) setAsked(null);
  async function updateNow() {
    setSaid(null);
    try {
      const response = await fetch('/api/update', { method: "POST" });
      const answer = await response.json();
      if (response.status === 202) setAsked(answer.status?.at || new Date().toISOString());
      else setSaid(answer.error || answer.message);
    } catch {
      setSaid("The update could not be started. Reload the page to try again.");
    }
    client.invalidateQueries({ queryKey: ["update"] });
  }
  if (!data && !error) return null;
  return (
    <div className="space-y-1 text-sm">
      {data?.newest && (
        <p>
          Newest version: {data.newest.version}{" "}
          (<a className="underline" href={data.newest.notes} target="_blank" rel="noreferrer">What changed</a>)
        </p>
      )}
      {data?.error && <p className="text-muted-foreground">{data.error}</p>}
      {running ? (
        <p role="status">{error ? "Restarting with the new version…" : status && RUNNING.includes(status.state) ? status.message : "Starting the update…"}</p>
      ) : (
        <>
          {status?.state === "failed" && <p role="alert" className="text-destructive">{status.message}</p>}
          {status?.state === "updated" && data?.installed === status.to && <p>Updated to {status.to}.</p>}
          {data?.newest && !data.newer && <p>You have the newest version.</p>}
          {data?.newer && (data.way === "handover" || data.way === "windows") && (
            <button type="button" className="border rounded px-3 py-1" onClick={updateNow}>Update now</button>
          )}
          {data?.newer && data.way === "terminal" && (
            <p>To update, run this in a terminal on this computer: <code>{data.command}</code></p>
          )}
          {data?.newer && data.way === "server" && (
            <>
              <p>To update, run this on your server: <code>{data.command}</code></p>
              <p className="text-muted-foreground">A server a hosting company set up with one click is updated in that company's panel.</p>
            </>
          )}
        </>
      )}
      {said && <p role="alert">{said}</p>}
      {data?.automatic && <AutomaticUpdates automatic={data.automatic} />}
    </div>
  );
}

type PauseChoice = "none" | "date" | "on";
function AutomaticUpdates({ automatic }: { automatic: AutomaticInfo }) {
  const client = useQueryClient();
  const [refused, setRefused] = useState<string | null>(null);
  // Choosing "Pause through" saves nothing until a date is picked.
  const [pickingDate, setPickingDate] = useState(false);
  const pause: PauseChoice = pickingDate || automatic.paused?.until ? "date" : automatic.paused ? "on" : "none";
  if (!automatic.offered) return <p className="text-muted-foreground">{automatic.reason}</p>;
  async function save(change: Partial<Pick<AutomaticInfo, "choice" | "time" | "paused">>) {
    setRefused(null);
    try {
      const response = await fetch('/api/update/automatic', { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      if (!response.ok) setRefused((await response.json()).error || "The choice could not be saved.");
    } catch {
      setRefused("The choice could not be saved. Reload the page to try again.");
    }
    client.invalidateQueries({ queryKey: ["update"] });
  }
  function choosePause(next: PauseChoice) {
    setPickingDate(next === "date");
    if (next === "none") void save({ paused: null });
    if (next === "on") void save({ paused: { until: null } });
  }
  const last = automatic.last;
  return (
    <fieldset className="space-y-1 pt-2">
      <legend className="font-semibold">Updates</legend>
      <label className="flex items-center gap-2">
        <input type="radio" name="update-choice" checked={automatic.choice === "myself"} onChange={() => void save({ choice: "myself" })} />
        Update myself
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="update-choice" checked={automatic.choice === "automatic"} onChange={() => void save({ choice: "automatic" })} />
        Update automatically
      </label>
      {automatic.choice === "automatic" && (
        <div className="space-y-1 pl-6">
          <label className="flex items-center gap-2">
            Install at
            <input type="time" className="border rounded px-1" value={automatic.time} onChange={event => { if (event.target.value) void save({ time: event.target.value }); }} />
          </label>
          <p className="text-muted-foreground">
            Godspeed checks once a day and installs a newer stable release at this time, in your time zone, when no chat or
            routine is running. A change counts from tomorrow on.
          </p>
          <label className="flex items-center gap-2">
            <input type="radio" name="update-pause" checked={pause === "none"} onChange={() => choosePause("none")} />
            Not paused
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="update-pause" checked={pause === "date"} onChange={() => choosePause("date")} />
            Pause through
            <input type="date" aria-label="Pause through" className="border rounded px-1" value={automatic.paused?.until || ""} disabled={pause !== "date"} onChange={event => { if (event.target.value) void save({ paused: { until: event.target.value } }); }} />
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="update-pause" checked={pause === "on"} onChange={() => choosePause("on")} />
            Pause until I turn it back on
          </label>
        </div>
      )}
      {last?.result === "failed" && <p className="text-muted-foreground">The last automatic update did not work: {last.message} It tries again the next day.</p>}
      {last?.result === "updated" && <p className="text-muted-foreground">Last updated itself to {last.to}.</p>}
      {refused && <p role="alert">{refused}</p>}
    </fieldset>
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
            <UpdateBlock />
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
