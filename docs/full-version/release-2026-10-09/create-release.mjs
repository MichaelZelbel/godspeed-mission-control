// Creates the GitHub release godspeed-v2-integrated-2026-10-09-1 and uploads its five files.
// Token from git's credential store (env GH_TOK), never printed.
import { readFileSync, statSync } from "node:fs";
const TOK = process.env.GH_TOK;
if (!TOK) { console.error("no token"); process.exit(1); }
const REPO = "MichaelZelbel/godspeed-mission-control";
const TAG = "godspeed-v2-integrated-2026-10-09-1";
const SHA = "d943f9042547d27725df0467e89056654db17b35";
const AS = process.argv[2];
const H = { Authorization: "Bearer " + TOK, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

let rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: H });
if (rel.status === 200) { rel = await rel.json(); console.log("release exists", rel.id); }
else {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: TAG, target_commitish: SHA, make_latest: "true",
      name: "Godspeed Mission Control v2 for the book's second edition (9 October)",
      body: readFileSync(AS + "/release-notes.md", "utf8"),
    }),
  });
  rel = await r.json();
  if (!rel.id) { console.error("create failed", r.status, JSON.stringify(rel).slice(0, 300)); process.exit(1); }
  console.log("created", rel.id, rel.html_url);
}
const have = new Set((rel.assets || []).map((a) => a.name));
const files = ["GodspeedSetup.exe", "install-godspeed.sh", "windows-manifest.json", "Godspeed-v2-integrated-source.tar.gz", "SHA256SUMS"];
for (const f of files) {
  if (have.has(f)) { console.log("already there", f); continue; }
  const body = readFileSync(`${AS}/${f}`);
  const up = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(f)}`, {
    method: "POST", headers: { ...H, "Content-Type": "application/octet-stream", "Content-Length": String(statSync(`${AS}/${f}`).size) }, body,
  });
  const j = await up.json();
  console.log(up.status, f, j.size ?? JSON.stringify(j).slice(0, 200));
}
