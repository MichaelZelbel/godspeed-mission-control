// Every file under src/pages/ that the product cannot open is dead weight that reviews, searches
// and fixes keep paying for: PR #949 spent a whole lap on a settings panel no route reaches (#957).
// This check fails, naming the file, when a page is not imported, directly or lazily, from App.tsx
// or from a module App.tsx reaches. It walks the whole src/pages/ tree, so a page in a
// subdirectory is checked too, and it reads imports with the TypeScript compiler, so a page whose
// only import is commented out is still unreachable. A new page wired to a route in App.tsx
// passes; a page dropped into src/pages/ without a route fails here before it costs anything.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const UI = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(UI, "src");
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"];

// The alias table is read from tsconfig.app.json, the file that owns it together with
// vite.config.ts, instead of being re-declared here: a fourth alias would then resolve in Vite
// but not in this graph (or the other way round) with nothing to catch the drift.
const tsconfigPath = join(UI, "tsconfig.app.json");
const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile).config;
const PATHS: Record<string, string[]> = tsconfig?.compilerOptions?.paths ?? {};
const TSCONFIG_DIR = dirname(tsconfigPath);

// Resolves an alias specifier to an absolute path, or null when no `paths` entry matches.
function resolveAlias(specifier: string): string | null {
  for (const [key, targets] of Object.entries(PATHS)) {
    if (!targets || targets.length === 0) continue;
    if (key.endsWith("/*")) {
      const prefix = key.slice(0, -1);
      if (specifier.startsWith(prefix)) {
        const rest = specifier.slice(prefix.length);
        const target = targets[0];
        return resolve(TSCONFIG_DIR, target.endsWith("/*") ? target.slice(0, -1) + rest : target + rest);
      }
    } else if (key === specifier) {
      return resolve(TSCONFIG_DIR, targets[0]);
    }
  }
  return null;
}

// The module specifiers a source text imports, read with the TypeScript compiler: plain and
// side-effect `import`, `export ... from`, `import x = require(...)` and the lazy `import('...')`
// App.tsx loads its pages with. Comments are not imports, so a commented-out import is ignored.
function importSpecifiers(source: string, tsx: boolean): string[] {
  const sourceFile = ts.createSourceFile(
    "module.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      const specifier = (node as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) found.push(specifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) found.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

// The local modules `file` imports, as absolute paths. Packages (no ./ start, no alias) are
// outside the tree and never reach a page file, so they are skipped rather than resolved.
function localImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const tsx = file.endsWith(".tsx") || file.endsWith(".jsx");
  const found: string[] = [];
  for (const specifier of importSpecifiers(source, tsx)) {
    const aliased = resolveAlias(specifier);
    if (aliased) found.push(aliased);
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

// Every file under `dir`, at any depth, so a page in a subdirectory of src/pages/ is checked too.
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

describe("every page under src/pages is reachable from App.tsx", () => {
  it("is imported by App.tsx or a module App.tsx reaches", () => {
    const reachable = reachableFromApp();
    const unreachable = walkFiles(join(SRC, "pages"))
      .filter((file) => !TEST_FILE.test(file))
      .filter((file) => !reachable.has(file))
      .map((file) => `src/${relative(SRC, file).split(sep).join("/")}`);
    expect(unreachable, "pages no route in App.tsx reaches").toEqual([]);
  });
});

describe("the guard's own mechanics", () => {
  it("ignores commented-out imports", () => {
    expect(importSpecifiers("// import Phantom from './pages/Phantom'", false)).toEqual([]);
    expect(importSpecifiers("/* import Phantom from './pages/Phantom' */", false)).toEqual([]);
    expect(importSpecifiers("/*\n * import('./pages/Ghost')\n */", false)).toEqual([]);
    expect(importSpecifiers("const x = 1; // import X from './x'", false)).toEqual([]);
  });

  it("reads plain, side-effect, re-export and lazy imports", () => {
    const source = [
      "import A from './a';",
      "import './side-effect.css';",
      "export { B } from './b';",
      "export * from './c';",
      "const lazy = () => import('./pages/Lazy');",
      "import type { T } from './type-only';",
    ].join("\n");
    expect(importSpecifiers(source, true)).toEqual([
      "./a",
      "./side-effect.css",
      "./b",
      "./c",
      "./pages/Lazy",
      "./type-only",
    ]);
  });

  it("resolves aliases from tsconfig.app.json paths", () => {
    expect(resolveAlias("@/local/Home")).toBe(join(SRC, "local", "Home"));
    expect(resolveAlias("@powersync/react")).toBe(join(SRC, "local", "disabled-row-sync.ts"));
    expect(resolveAlias("react")).toBe(null);
  });

  it("walks src/pages into its subdirectories and skips test files", () => {
    const root = mkdtempSync(join(tmpdir(), "pages-guard-"));
    try {
      mkdirSync(join(root, "sub"), { recursive: true });
      writeFileSync(join(root, "Top.tsx"), "export default null;");
      writeFileSync(join(root, "sub", "Nested.tsx"), "export default null;");
      writeFileSync(join(root, "sub", "Nested.test.tsx"), "export default null;");
      writeFileSync(join(root, "spec-file.spec.js"), "export default null;");
      const pages = walkFiles(root)
        .filter((file) => !TEST_FILE.test(file))
        .sort();
      expect(pages).toEqual([join(root, "Top.tsx"), join(root, "sub", "Nested.tsx")].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
