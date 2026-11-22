// Every file under src/pages/ that the product cannot open is dead weight that reviews, searches
// and fixes keep paying for: PR #949 spent a whole lap on a settings panel no route reaches (#957).
// This check fails, naming the file, when a page is not imported, directly or lazily, from App.tsx
// or from a module App.tsx reaches. A new page wired to a route in App.tsx passes; a page dropped
// into src/pages/ without a route fails here before it costs anything.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"];

// The forms the UI uses to import a local module: `import x from '...'`, `import '...'`,
// `export x from '...'` and the lazy `import('...')` App.tsx loads its pages with. Packages (no
// ./, @/ or @powersync/ start) are outside the tree and never reach a page file, so they are
// skipped rather than resolved.
function localImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const pattern =
    /(?:^|[\s;])(?:import\s+[^'"()]*?from\s*|import\s*|export\s+[^'"()]*?from\s*)['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] || match[2];
    if (!specifier) continue;
    if (specifier.startsWith("@/")) found.push(join(SRC, specifier.slice(2)));
    else if (specifier.startsWith("@powersync/")) found.push(join(SRC, "local/disabled-row-sync"));
    else if (specifier.startsWith(".")) found.push(resolve(dirname(file), specifier));
  }
  return found;
}

function moduleFile(base: string): string | null {
  const candidates = [base];
  for (const extension of EXTENSIONS) candidates.push(base + extension);
  candidates.push(join(base, "index.tsx"), join(base, "index.ts"), join(base, "index.js"));
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function reachableFromApp(): Set<string> {
  const seen = new Set<string>();
  const stack = [join(SRC, "App.tsx")];
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of localImports(file)) {
      const module = moduleFile(specifier);
      if (module) stack.push(module);
    }
  }
  return seen;
}

describe("every page under src/pages is reachable from App.tsx", () => {
  it("is imported by App.tsx or a module App.tsx reaches", () => {
    const reachable = reachableFromApp();
    const unreachable = readdirSync(join(SRC, "pages"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.match(/\.test\.(ts|tsx)$/))
      .map((entry) => join(SRC, "pages", entry.name))
      .filter((file) => !reachable.has(file))
      .map((file) => `src/pages/${file.split("/").pop()}`);
    expect(unreachable, "pages no route in App.tsx reaches").toEqual([]);
  });
});
