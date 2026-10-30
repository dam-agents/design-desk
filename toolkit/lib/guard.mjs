// The design-only guard. A prototype may change how the product looks, never what it
// does; this reads a diff and says, file by file, which one it is.
//
// Paths: the profile's `boundary.deny` globs refuse a file outright, `boundary.allow`
// globs admit it to the check below, anything else is refused.
// Code (.ts/.tsx/.js/.jsx): each side is reduced to a behaviour fingerprint —
//   imports    modules the file uses that are not presentational,
//   statements every non-JSX statement, normalized: JSX → __JSX__, copy and class
//              strings → "__S__", comments and formatting gone,
//   bindings   what the markup wires to behaviour: event handlers, links, values,
//              conditions, lists, and data passed to components.
// Markup structure, classes, styles, copy and presentational components are not in
// it, so moving, restyling and rewording leave it unchanged. A fingerprint that
// changes is a behaviour change, with three tolerated additions: view-only state
// (useState/useRef/useId with a literal start), new presentational components, and
// bindings built only from what was already bound or from that new view state.
import { posix } from "node:path";
import { req } from "./core.mjs";

const ts = () => req("typescript");

export const DEFAULTS = {
  class_helpers: ["cn", "clsx", "cva", "twMerge", "classNames", "cx"],
  copy_helpers: ["t", "i18n.t", "formatMessage"],
  // Attributes that never carry behaviour on any element.
  ignored_attrs: ["className", "class", "style", "key", "id", "title", "role", "tabIndex", "icon", "size", "variant", "tone", "align", "side", "sideOffset", "asChild", "alt", "loading", "placeholder", "label", "description", "aria-*", "data-*"],
  ui_state_hooks: ["useState", "useRef", "useId"],
  react_presentational: ["Fragment", "useState", "useRef", "useId", "forwardRef", "memo"],
};

// ---------- globs ----------

export function globRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += glob[i + 2] === "/" ? 2 : 1; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
const matchAny = (path, globs = []) => globs.some((g) => globRe(g).test(path));

// ---------- fingerprint ----------

function attrIgnored(name, cfg) {
  return cfg.ignored_attrs.some((a) => (a.endsWith("*") ? name.startsWith(a.slice(0, -1)) : a === name));
}

function calleeName(expr) {
  const T = ts();
  if (T.isIdentifier(expr)) return expr.text;
  if (T.isPropertyAccessExpression(expr)) { const l = calleeName(expr.expression); return l ? `${l}.${expr.name.text}` : expr.name.text; }
  return "";
}

// A string keeps its content only where it can steer behaviour: compared, switched
// on, used as a key, or passed to a call that is not a class or copy helper.
function stringMatters(node, cfg) {
  const T = ts();
  const p = node.parent;
  if (!p) return true;
  if (T.isBinaryExpression(p) && [T.SyntaxKind.EqualsEqualsEqualsToken, T.SyntaxKind.ExclamationEqualsEqualsToken, T.SyntaxKind.EqualsEqualsToken, T.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true;
  if (T.isCaseClause(p) || T.isElementAccessExpression(p) || T.isImportDeclaration(p) || T.isExportDeclaration(p) || T.isLiteralTypeNode(p) || T.isExternalModuleReference(p)) return true;
  if (T.isPropertyAssignment(p) && p.name === node) return true;
  if (T.isCallExpression(p) && p.arguments.includes(node)) {
    const name = calleeName(p.expression);
    return !(cfg.class_helpers.includes(name) || cfg.copy_helpers.includes(name));
  }
  if (T.isPropertyAssignment(p) && T.isIdentifier(p.name) && /class(name)?$|classes$/i.test(p.name.text)) return false;
  return false;
}

function normalize(node, sf, cfg) {
  const T = ts();
  const transformer = (ctx) => {
    const visit = (n) => {
      if (T.isJsxElement(n) || T.isJsxSelfClosingElement(n) || T.isJsxFragment(n)) return ctx.factory.createIdentifier("__JSX__");
      if ((T.isStringLiteral(n) || T.isNoSubstitutionTemplateLiteral(n)) && !stringMatters(n, cfg)) return ctx.factory.createStringLiteral("__S__");
      if (T.isTemplateExpression(n) && T.isCallExpression(n.parent) && cfg.class_helpers.includes(calleeName(n.parent.expression))) return ctx.factory.createStringLiteral("__S__");
      return T.visitEachChild(n, visit, ctx);
    };
    return (root) => T.visitNode(root, visit);
  };
  const out = T.transform(node, [transformer]);
  const printer = T.createPrinter({ removeComments: true, newLine: T.NewLineKind.LineFeed });
  const text = printer.printNode(T.EmitHint.Unspecified, out.transformed[0], sf);
  out.dispose();
  return text.replace(/\s+/g, " ").trim();
}

function identifiersIn(node) {
  const T = ts();
  const ids = new Set();
  const walk = (n) => {
    // Nested markup has bindings of its own; its tags and classes are not this one's.
    if (n !== node && (T.isJsxElement(n) || T.isJsxSelfClosingElement(n) || T.isJsxFragment(n))) return;
    if (T.isIdentifier(n)) {
      const p = n.parent;
      const isMember = p && T.isPropertyAccessExpression(p) && p.name === n;
      const isKey = p && (T.isPropertyAssignment(p) || T.isJsxAttribute(p)) && p.name === n;
      if (!isMember && !isKey) ids.add(n.text);
    }
    T.forEachChild(n, walk);
  };
  walk(node);
  return ids;
}

export function fingerprint(source, fileName, cfgIn = {}) {
  const T = ts();
  const cfg = { ...DEFAULTS, ...cfgIn };
  const kind = /\.[jt]sx$/.test(fileName) ? T.ScriptKind.TSX : /\.ts$/.test(fileName) ? T.ScriptKind.TS : T.ScriptKind.JS;
  const sf = T.createSourceFile(fileName, source, T.ScriptTarget.Latest, true, kind);
  const fp = { imports: new Map(), statements: [], bindings: new Map(), components: new Set(), uiState: new Set(), paramsBy: new Map() };

  const addBinding = (key, exprNode) => {
    if (!fp.bindings.has(key)) fp.bindings.set(key, identifiersIn(exprNode));
  };

  const visitJsx = (n) => {
    if (T.isJsxElement(n)) { visitOpening(n.openingElement); n.children.forEach(visitJsxChild); return; }
    if (T.isJsxSelfClosingElement(n)) { visitOpening(n); return; }
    if (T.isJsxFragment(n)) { n.children.forEach(visitJsxChild); }
  };
  const visitOpening = (el) => {
    for (const a of el.attributes.properties) {
      if (T.isJsxSpreadAttribute(a)) { addBinding(`...${normalize(a.expression, sf, cfg)}`, a.expression); visitInner(a.expression); continue; }
      const name = a.name.getText(sf);
      if (attrIgnored(name, cfg)) { if (a.initializer && T.isJsxExpression(a.initializer) && a.initializer.expression) visitInner(a.initializer.expression); continue; }
      if (!a.initializer) { addBinding(`${name}`, a.name); continue; }
      if (T.isStringLiteral(a.initializer)) {
        // A literal only steers behaviour on attributes that do something.
        if (/^(on[A-Z]|href$|to$|type$|value$|name$|action$|method$|form$|target$|download$|disabled$|checked$|defaultValue$|defaultChecked$|required$|pattern$|min$|max$|accept$)/.test(name))
          addBinding(`${name}=${JSON.stringify(a.initializer.text)}`, a.initializer);
        continue;
      }
      if (T.isJsxExpression(a.initializer) && a.initializer.expression) {
        addBinding(`${name}={${normalize(a.initializer.expression, sf, cfg)}}`, a.initializer.expression);
        visitInner(a.initializer.expression);
      }
    }
  };
  const visitJsxChild = (c) => {
    if (T.isJsxText(c)) return;
    if (T.isJsxExpression(c)) {
      if (!c.expression) return;
      if (!(T.isStringLiteral(c.expression) || T.isNoSubstitutionTemplateLiteral(c.expression))) addBinding(`{${normalize(c.expression, sf, cfg)}}`, c.expression);
      visitInner(c.expression);
      return;
    }
    visitJsx(c);
  };
  // JSX nested in an expression (a condition, a map callback) has bindings of its own.
  const visitInner = (expr) => {
    const walk = (n) => { if (T.isJsxElement(n) || T.isJsxSelfClosingElement(n) || T.isJsxFragment(n)) { visitJsx(n); return; } T.forEachChild(n, walk); };
    walk(expr);
  };

  const fnBody = (fn, name) => {
    if (name && /^[A-Z]/.test(name)) {
      fp.components.add(name);
      fp.paramsBy.set(name, new Set((fn.parameters || []).flatMap((p) => [...identifiersIn(p.name)])));
    }
    if (!fn.body) return;
    if (T.isBlock(fn.body)) fn.body.statements.forEach(stmt);
    else { fp.statements.push(`=> ${normalize(fn.body, sf, cfg)}`); visitInner(fn.body); }
  };

  const header = (n) => {
    const name = n.name?.getText(sf) || "";
    const params = (n.parameters || []).map((p) => normalize(p, sf, cfg)).join(", ");
    return `${/^[A-Z]/.test(name) ? "component" : "function"} ${name}(${params})`;
  };

  const stmt = (s) => {
    if (T.isImportDeclaration(s)) {
      if (s.importClause?.isTypeOnly) return;
      const mod = s.moduleSpecifier.text;
      const names = [];
      const ic = s.importClause;
      if (ic?.name) names.push("default");
      if (ic?.namedBindings) {
        if (T.isNamespaceImport(ic.namedBindings)) names.push("*");
        else for (const e of ic.namedBindings.elements) if (!e.isTypeOnly) names.push((e.propertyName || e.name).text);
      }
      if (!ic) names.push("(side effect)");
      fp.imports.set(mod, new Set([...(fp.imports.get(mod) || []), ...names]));
      return;
    }
    if (T.isTypeAliasDeclaration(s) || T.isInterfaceDeclaration(s)) return;
    if (T.isExportDeclaration(s) && s.isTypeOnly) return;
    if (T.isFunctionDeclaration(s)) { fp.statements.push(header(s)); fnBody(s, s.name?.text); return; }
    if (T.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const init = d.initializer;
        const fn = init && (T.isArrowFunction(init) || T.isFunctionExpression(init)) ? init
          : init && T.isCallExpression(init) && ["forwardRef", "memo", "React.forwardRef", "React.memo"].includes(calleeName(init.expression)) && init.arguments[0] && (T.isArrowFunction(init.arguments[0]) || T.isFunctionExpression(init.arguments[0])) ? init.arguments[0] : null;
        if (fn) { fp.statements.push(`${/^[A-Z]/.test(d.name.getText(sf)) ? "component" : "function"} ${d.name.getText(sf)}(${fn.parameters.map((p) => normalize(p, sf, cfg)).join(", ")})`); fnBody(fn, d.name.getText(sf)); continue; }
        const text = normalize(d, sf, cfg);
        fp.statements.push(`const ${text}`);
        if (init && T.isCallExpression(init) && cfg.ui_state_hooks.includes(calleeName(init.expression).replace(/^React\./, ""))) {
          const literal = init.arguments.length === 0 || (init.arguments.length === 1 && [T.SyntaxKind.TrueKeyword, T.SyntaxKind.FalseKeyword, T.SyntaxKind.NullKeyword, T.SyntaxKind.NumericLiteral, T.SyntaxKind.StringLiteral, T.SyntaxKind.Identifier].includes(init.arguments[0].kind) && (!T.isIdentifier(init.arguments[0]) || init.arguments[0].text === "undefined"));
          if (literal) for (const id of identifiersIn(d.name)) fp.uiState.add(id);
        }
        if (init) visitInner(init);
      }
      return;
    }
    if (T.isReturnStatement(s)) { fp.statements.push(`return ${s.expression ? normalize(s.expression, sf, cfg) : ""}`); if (s.expression) visitInner(s.expression); return; }
    if (T.isIfStatement(s)) { fp.statements.push(`if (${normalize(s.expression, sf, cfg)})`); visitInner(s.expression); block(s.thenStatement); if (s.elseStatement) { fp.statements.push("else"); block(s.elseStatement); } return; }
    if (T.isBlock(s)) { s.statements.forEach(stmt); return; }
    if (T.isExportAssignment(s)) { fp.statements.push(normalize(s, sf, cfg)); return; }
    fp.statements.push(normalize(s, sf, cfg));
    visitInner(s);
  };
  const block = (s) => (T.isBlock(s) ? s.statements.forEach(stmt) : stmt(s));
  sf.statements.forEach(stmt);
  return fp;
}

// ---------- comparing two sides ----------

function multisetDiff(a, b) {
  const count = new Map();
  for (const x of b) count.set(x, (count.get(x) || 0) + 1);
  const onlyA = [];
  for (const x of a) { const n = count.get(x) || 0; if (n) count.set(x, n - 1); else onlyA.push(x); }
  return onlyA;
}

const UI_STATE_RE = /^const \[\w+, set\w+\] = (React\.)?useState(<[^>]*>)?\((true|false|null|undefined|-?\d+(\.\d+)?|"__S__")?\)$|^const \w+ = (React\.)?use(Ref|Id)(<[^>]*>)?\((null|undefined)?\)$/;
const BEHAVIOUR_ATTR = /^(on[A-Z]\w*|href|to|type|value|name|action|method|form|target|download|disabled|checked|defaultValue|defaultChecked|required|pattern|min|max|accept|open|onOpenChange)(=|$)/;
const GLOBALS = new Set(["true", "false", "null", "undefined", "event", "e", "_", "Boolean", "String", "Number", "Math"]);

export function isPresentationalImport(mod, names, file, profile) {
  const b = profile.boundary || {};
  if (mod === "react" || mod === "react/jsx-runtime") return [...names].every((n) => DEFAULTS.react_presentational.includes(n) || n === "default" || n === "*");
  if ((b.presentational_imports || []).some((re) => new RegExp(re).test(mod))) return true;
  let path = null;
  for (const [alias, target] of Object.entries(b.aliases || {})) if (mod === alias || mod.startsWith(alias.endsWith("/") ? alias : `${alias}/`)) path = posix.join(target, mod.slice(alias.length));
  if (!path && mod.startsWith(".")) path = posix.normalize(posix.join(posix.dirname(file), mod));
  if (!path) return false;
  const bare = path.replace(/\.(js|mjs|jsx|ts|tsx)$/, "");
  return [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", ""].some((ext) => matchAny(bare + ext, b.allow) && !matchAny(bare + ext, b.deny))
    && !matchAny(bare + ".ts", b.deny) && !matchAny(bare + ".tsx", b.deny);
}

export function compare(baseSrc, headSrc, file, profile = {}) {
  const cfg = { ...DEFAULTS, ...(profile.boundary?.code || {}) };
  const base = baseSrc === null ? null : fingerprint(baseSrc, file, cfg);
  const head = headSrc === null ? null : fingerprint(headSrc, file, cfg);
  const issues = [], notes = [];
  if (!head) {
    return { verdict: "removed", issues: ["deletes a file; a component that people use may disappear with it"], notes };
  }
  const B = base || { imports: new Map(), statements: [], bindings: new Map(), components: new Set(), uiState: new Set(), paramsBy: new Map() };

  for (const [mod, names] of head.imports) {
    const before = B.imports.get(mod) || new Set();
    const added = [...names].filter((n) => !before.has(n));
    if (added.length && !isPresentationalImport(mod, new Set(added), file, profile)) issues.push(`starts using ${added.join(", ")} from ${mod}`);
  }
  for (const [mod, names] of B.imports) {
    const after = head.imports.get(mod) || new Set();
    const gone = [...names].filter((n) => !after.has(n));
    if (gone.length && !isPresentationalImport(mod, new Set(gone), file, profile)) issues.push(`stops using ${gone.join(", ")} from ${mod}`);
  }

  const removed = multisetDiff(B.statements, head.statements);
  const added = multisetDiff(head.statements, B.statements);
  const newState = new Set([...head.uiState].filter((x) => !B.uiState.has(x)));
  const newComponents = new Set([...head.components].filter((x) => !B.components.has(x)));
  for (const s of added) {
    if (UI_STATE_RE.test(s)) { notes.push(`adds view-only state: ${s.replace(/^const /, "")}`); continue; }
    if (/^component \w+\(/.test(s) && newComponents.has(s.match(/^component (\w+)/)[1])) { notes.push(`adds a presentational component ${s.match(/^component (\w+)/)[1]}`); continue; }
    if (/^return __JSX__;?$|^=> __JSX__$/.test(s)) continue;
    issues.push(`changes code: ${s.slice(0, 160)}`);
  }
  for (const s of removed) {
    if (/^return __JSX__;?$|^=> __JSX__$/.test(s) && !newComponents.size) { issues.push(`changes code: removes ${s}`); continue; }
    if (/^return __JSX__;?$|^=> __JSX__$/.test(s)) continue;
    issues.push(`changes code: removes ${s.slice(0, 160)}`);
  }

  // A new binding may use only what the old markup already used, the new view state,
  // and the props of a new presentational component.
  const known = new Set([...B.bindings.values()].flatMap((s) => [...s]));
  for (const id of newState) known.add(id);
  for (const c of newComponents) for (const p of head.paramsBy.get(c) || []) known.add(p);
  for (const c of head.components) known.add(c);
  const removals = [...B.bindings.keys()].filter((k) => !head.bindings.has(k));
  // A new handler, link, value or switch may only drive the new view state: anything
  // else on such an attribute is new behaviour even when it reuses known names.
  const viewOnly = new Set(newState);
  for (const c of newComponents) for (const p of head.paramsBy.get(c) || []) viewOnly.add(p);
  for (const k of [...head.bindings.keys()].filter((k) => !B.bindings.has(k))) {
    const ids = [...head.bindings.get(k)].filter((id) => !GLOBALS.has(id));
    const behaviourAttr = BEHAVIOUR_ATTR.test(k);
    const unknown = ids.filter((id) => !(behaviourAttr ? viewOnly : known).has(id));
    if (unknown.length || (behaviourAttr && !ids.length)) issues.push(`wires new behaviour: ${k.slice(0, 160)}${unknown.length ? ` (uses ${unknown.slice(0, 4).join(", ")})` : ""}`);
    else notes.push(`rewires: ${k.slice(0, 120)}`);
  }
  const verdict = issues.length ? "logic" : removals.length ? "removed" : notes.length ? "ui-state" : "ok";
  if (removals.length) issues.push(...removals.map((k) => `no longer offers: ${k.slice(0, 160)}`));
  return { verdict, issues, notes };
}

// ---------- the whole diff ----------

const PLAIN = {
  en: {
    ok: "Only the look changed (layout, styles, copy or icons).",
    "ui-state": "Only the look changed, plus view-only state such as open/closed.",
    style: "Only styles changed.",
    global: "Changes styles used across the whole product.",
    asset: "An image or icon file.",
    logic: "Changes what the product does, not only how it looks.",
    removed: "Takes away something people can see or use today.",
    denied: "This file is outside what a design change may touch.",
  },
};

export function plainVerdict(v, lang = "en") { return (PLAIN[lang] || PLAIN.en)[v] || v; }

export function classifyPath(path, profile) {
  const b = profile.boundary || {};
  if (matchAny(path, b.deny)) return { verdict: "denied", issues: [`${path} is on the profile's deny list`] };
  if (!matchAny(path, b.allow)) return { verdict: "denied", issues: [`${path} is not on the profile's allow list`] };
  if (/\.(css|scss|sass|less|pcss)$/.test(path)) return { verdict: matchAny(path, b.global_styles) ? "global" : "style", issues: [] };
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|otf)$/.test(path)) return { verdict: "asset", issues: [] };
  if (/\.(tsx|ts|jsx|js|mjs)$/.test(path)) return { verdict: "code", issues: [] };
  if (matchAny(path, b.allow_other)) return { verdict: "ok", issues: [] };
  return { verdict: "denied", issues: [`${path}: a ${path.split(".").pop()} file is neither style, image nor component code`] };
}

export function judge(changes, profile, readSide) {
  const files = [];
  for (const c of changes) {
    const where = classifyPath(c.path, profile);
    if (where.verdict !== "code") { files.push({ path: c.path, status: c.status, ...where, notes: [] }); continue; }
    const before = c.status === "A" ? null : readSide("base", c.oldPath || c.path);
    const after = c.status === "D" ? null : readSide("head", c.path);
    let r;
    try { r = compare(before, after, c.path, profile); } catch (e) { r = { verdict: "logic", issues: [`could not read the code (${e.message}); a person must review it`], notes: [] }; }
    files.push({ path: c.path, status: c.status, ...r });
  }
  const bad = files.filter((f) => ["denied", "logic", "removed"].includes(f.verdict));
  const counts = files.reduce((m, f) => (m[f.verdict] = (m[f.verdict] || 0) + 1, m), {});
  return {
    ok: files.length > 0 && bad.length === 0,
    empty: files.length === 0,
    counts,
    files: files.map((f) => ({ ...f, plain: plainVerdict(f.verdict) })),
    summary: files.length === 0 ? "No change to check." : bad.length ? `${bad.length} of ${files.length} files go beyond design: ${bad.map((f) => f.path).slice(0, 5).join(", ")}` : `All ${files.length} files change only the look.`,
  };
}
