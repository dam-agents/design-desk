// Module mocks for rendering a real component outside its app. A module whose path
// matches one of the profile's `mock_modules` patterns (data access, app hooks, stores)
// is replaced by a stub with the same export names: each export reads the value the
// state being drawn set for it (`mocks='{"useKeptWorkCount": 2}'` on <ui-component>),
// and otherwise falls back by its name — a query hook answers "loaded, empty", a
// mutation hook "idle", another hook `undefined`, a component nothing, anything else a
// harmless object that accepts any property or call. So a state sheet draws the real
// component's markup in every state without the app, a server or a provider.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { req } from "./core.mjs";

const RUNTIME = `
const __m = () => globalThis.__deskMocks || {};
const __noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : __noop), apply: () => __noop });
const __QUERY = new Set(__QUERY_NAMES__), __MUTATION = new Set(__MUTATION_NAMES__);
function __value(name, args) {
  const m = __m();
  if (Object.prototype.hasOwnProperty.call(m, name)) return m[name];
  if (__QUERY.has(name) || /^use\\w*(Query|Queries)$/.test(name)) return { data: undefined, isLoading: false, isPending: false, isFetching: false, isError: false, error: null, refetch() {} };
  if (__MUTATION.has(name) || /^use\\w*Mutation$/.test(name)) return { mutate() {}, mutateAsync: async () => {}, isPending: false, isError: false, reset() {} };
  if (/^use[A-Z]/.test(name)) return undefined;
  return __noop;
}
`;

// Export names of a module, read from its source (functions, consts, classes, default,
// and the names an `export { … } from` re-exports).
export function exportNames(source, fileName) {
  const T = req("typescript");
  const sf = T.createSourceFile(fileName, source, T.ScriptTarget.Latest, true, /x$/.test(fileName) ? T.ScriptKind.TSX : T.ScriptKind.TS);
  const names = new Set();
  let star = false;
  for (const s of sf.statements) {
    const exported = s.modifiers?.some((m) => m.kind === T.SyntaxKind.ExportKeyword);
    const isDefault = s.modifiers?.some((m) => m.kind === T.SyntaxKind.DefaultKeyword);
    if (T.isExportAssignment(s)) names.add("default");
    else if (exported && isDefault) names.add("default");
    else if (exported && (T.isFunctionDeclaration(s) || T.isClassDeclaration(s)) && s.name) names.add(s.name.text);
    else if (exported && T.isVariableStatement(s)) for (const d of s.declarationList.declarations) { if (T.isIdentifier(d.name)) names.add(d.name.text); }
    else if (exported && T.isEnumDeclaration(s)) names.add(s.name.text);
    else if (T.isExportDeclaration(s) && !s.isTypeOnly) {
      if (s.exportClause && T.isNamedExports(s.exportClause)) for (const e of s.exportClause.elements) { if (!e.isTypeOnly) names.add(e.name.text); }
      else if (!s.exportClause) star = true;
    }
  }
  // What each exported hook wraps, read from its body: a query, a mutation, or neither
  // (a flag or a plain value, whose stand-in is undefined: the default branch).
  const kinds = {};
  for (const s of sf.statements) {
    const fn = T.isFunctionDeclaration(s) ? s : T.isVariableStatement(s) ? s.declarationList.declarations[0]?.initializer : null;
    const name = T.isFunctionDeclaration(s) ? s.name?.text : T.isVariableStatement(s) ? s.declarationList.declarations[0]?.name?.getText(sf) : null;
    if (!name || !/^use[A-Z]/.test(name) || !fn) continue;
    const body = fn.getText(sf);
    kinds[name] = /\buse(Suspense)?(Infinite)?Quer(y|ies)\s*[(<]|\.useQuery\s*\(|queryOptions\s*\(/.test(body) ? "query" : /\buseMutation\s*[(<]|mutationOptions\s*\(/.test(body) ? "mutation" : "other";
  }
  return { names: [...names], star, kinds };
}

export function stubSource(names, kinds = {}) {
  const pick = (k) => JSON.stringify(Object.keys(kinds).filter((n) => kinds[n] === k));
  const lines = [RUNTIME.replace("__QUERY_NAMES__", pick("query")).replace("__MUTATION_NAMES__", pick("mutation"))];
  for (const n of names) {
    if (n === "default") lines.push(`export default function __default(...a) { return __value("default", a); }`);
    else if (/^[A-Z]/.test(n) && !/^[A-Z0-9_]+$/.test(n)) lines.push(`export function ${n}(...a) { const v = __m()[${JSON.stringify(n)}]; return v === undefined ? null : v; }`);
    else if (/^use[A-Z]/.test(n)) lines.push(`export function ${n}(...a) { return __value(${JSON.stringify(n)}, a); }`);
    else lines.push(`export const ${n} = __m()[${JSON.stringify(n)}] ?? __noop;`);
  }
  return lines.join("\n");
}

// The esbuild plugin. `patterns` are regexes against the path relative to the clone.
export function mockPlugin(root, patterns) {
  const res = (patterns || []).map((p) => new RegExp(p));
  return {
    name: "desk-mocks",
    setup(build) {
      if (!res.length) return;
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.deskInner || args.kind === "entry-point") return null;
        const r = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { deskInner: true } });
        if (r.errors.length || !r.path || r.path.includes("/node_modules/")) return null;
        const rel = relative(root, r.path);
        return res.some((re) => re.test(rel)) ? { path: r.path, namespace: "desk-mock" } : null;
      });
      build.onLoad({ filter: /.*/, namespace: "desk-mock" }, (args) => {
        const { names, kinds } = exportNames(readFileSync(args.path, "utf8"), args.path);
        return { contents: stubSource(names, kinds), loader: "js" };
      });
    },
  };
}
