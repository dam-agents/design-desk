// The guard for TypeScript and JavaScript with React (lib/guard.mjs picks it by extension).
//
// Each side of a file is reduced to a behaviour fingerprint —
//   imports     modules the file uses that are not presentational;
//   statements  every statement outside the markup, IN ORDER, per function: JSX
//               becomes __JSX__, copy and class strings "__S__", every other string
//               keeps its text (an address, a method, a status is behaviour);
//   bindings    what the markup wires to behaviour: handlers, links, values,
//               conditions, lists, data passed to components, and any attribute —
//               even a class or a style — whose expression calls or assigns.
// Markup structure, classes, styles, copy and presentational components are not in it,
// so moving, restyling and rewording leave it unchanged. Anything else that changes is
// a behaviour change, with three tolerated additions: view-only state (useState,
// useRef, useId with a literal start), new presentational components, and new markup
// bindings that read only what the old markup read, call nothing but formatting and
// the new view state's setters, and add no condition on existing data.
import { posix } from "node:path";
import { req } from "../core.mjs";
import { matchAny } from "../globs.mjs";

export const exts = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;

const ts = () => req("typescript");

export const DEFAULTS = {
  class_helpers: ["cn", "clsx", "cva", "twMerge", "classNames", "cx"],
  copy_helpers: ["t", "i18n.t", "formatMessage"],
  // Attributes whose literal text is presentation or copy. An expression in them is
  // still judged: one that calls or assigns is behaviour.
  ignored_attrs: ["className", "class", "style", "key", "id", "title", "role", "tabIndex", "icon", "size", "variant", "tone", "align", "side", "sideOffset", "asChild", "alt", "loading", "placeholder", "label", "description", "aria-*", "data-*"],
  ui_state_hooks: ["useState", "useRef", "useId"],
  react_presentational: ["Fragment", "useState", "useRef", "useId", "forwardRef", "memo"],
  // Calls a new piece of markup may make: formatting and reading, never acting.
  safe_calls: ["map", "filter", "slice", "join", "concat", "includes", "some", "every", "find", "findIndex", "at", "flat",
    "toUpperCase", "toLowerCase", "trim", "padStart", "padEnd", "split", "replace", "startsWith", "endsWith", "toFixed",
    "toString", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "String", "Number", "Boolean",
    "Math.min", "Math.max", "Math.round", "Math.floor", "Math.ceil", "Math.abs", "Object.keys", "Object.values",
    "Object.entries", "Array.from", "Array.isArray"],
};


// ---------- syntax helpers ----------

const isJsx = (n) => { const T = ts(); return T.isJsxElement(n) || T.isJsxSelfClosingElement(n) || T.isJsxFragment(n); };

function calleeName(expr) {
  const T = ts();
  if (T.isIdentifier(expr)) return expr.text;
  if (T.isPropertyAccessExpression(expr)) { const l = calleeName(expr.expression); return l ? `${l}.${expr.name.text}` : expr.name.text; }
  if (T.isCallExpression(expr)) return calleeName(expr.expression);
  return "";
}

function attrIgnored(name, cfg) {
  return cfg.ignored_attrs.some((a) => (a.endsWith("*") ? name.startsWith(a.slice(0, -1)) : a === name));
}

const CLASS_VAR = /^(cls|classes|styles|.*[cC]lass(es|Name|Names)?)$/;

// Is this string copy or a class list (free to change), or does it steer behaviour?
// Walks up to the first deciding ancestor: a comparison, a key or a call that is not a
// class or copy helper keeps the text; a class/copy position or JSX text frees it.
function isCopyOrClass(node, cfg) {
  const T = ts();
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (T.isBinaryExpression(p) && p.operatorToken.kind !== T.SyntaxKind.AmpersandAmpersandToken && p.operatorToken.kind !== T.SyntaxKind.BarBarToken && p.operatorToken.kind !== T.SyntaxKind.QuestionQuestionToken && p.operatorToken.kind !== T.SyntaxKind.PlusToken) return false;
    if (T.isCaseClause(p) || T.isElementAccessExpression(p) || T.isImportDeclaration(p) || T.isExportDeclaration(p) || T.isLiteralTypeNode(p) || T.isExternalModuleReference(p)) return false;
    if (T.isPropertyAssignment(p) && p.name === child) return false;
    if (T.isJsxAttribute(p)) return attrIgnored(p.name.getText(), cfg);
    if (T.isJsxExpression(p) && p.parent && (T.isJsxElement(p.parent) || T.isJsxFragment(p.parent))) return true;
    if (T.isCallExpression(p)) {
      const name = calleeName(p.expression);
      return cfg.class_helpers.includes(name) || cfg.copy_helpers.includes(name);
    }
    if (T.isVariableDeclaration(p)) return T.isIdentifier(p.name) && CLASS_VAR.test(p.name.text);
    if (T.isPropertyAssignment(p) && T.isIdentifier(p.name) && /class(Name)?$|classes$/i.test(p.name.text)) return true;
    if (T.isStatement(p) || T.isArrowFunction(p) || T.isFunctionExpression(p)) return false;
  }
  return false;
}

function normalize(node, sf, cfg) {
  const T = ts();
  const transformer = (ctx) => {
    const visit = (n) => {
      if (isJsx(n)) return ctx.factory.createIdentifier("__JSX__");
      if ((T.isStringLiteral(n) || T.isNoSubstitutionTemplateLiteral(n)) && isCopyOrClass(n, cfg)) return ctx.factory.createStringLiteral("__S__");
      if (T.isTemplateExpression(n) && isCopyOrClass(n, cfg)) {
        // The text of a copy or class template is free; its expressions are not.
        return ctx.factory.createTemplateExpression(ctx.factory.createTemplateHead("__S__"),
          n.templateSpans.map((s, i) => ctx.factory.createTemplateSpan(T.visitNode(s.expression, visit),
            i === n.templateSpans.length - 1 ? ctx.factory.createTemplateTail("__S__") : ctx.factory.createTemplateMiddle("__S__"))));
      }
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

// What an expression reads and does: the free identifiers (names it declares itself,
// like a callback's parameters, are not free), the member chains it reads, the calls
// it makes, whether it assigns, and whether it decides anything.
function analyze(expr) {
  const T = ts();
  const bound = new Set(), ids = new Set(), members = new Set(), calls = [];
  let writes = false, decides = false;
  const bind = (name) => { for (const id of identifiersOf(name)) bound.add(id); };
  const walk = (n) => {
    if (n !== expr && isJsx(n)) return; // nested markup has bindings of its own
    if (T.isArrowFunction(n) || T.isFunctionExpression(n)) for (const p of n.parameters) bind(p.name);
    if (T.isVariableDeclaration(n)) bind(n.name);
    if (T.isCallExpression(n) || T.isNewExpression(n)) calls.push(T.isNewExpression(n) ? `new ${calleeName(n.expression)}` : calleeName(n.expression) || "(computed)");
    if (T.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      if (k >= T.SyntaxKind.FirstAssignment && k <= T.SyntaxKind.LastAssignment) writes = true;
      if ([T.SyntaxKind.AmpersandAmpersandToken, T.SyntaxKind.BarBarToken, T.SyntaxKind.QuestionQuestionToken].includes(k) || (k >= T.SyntaxKind.LessThanToken && k <= T.SyntaxKind.ExclamationEqualsEqualsToken)) decides = true;
    }
    if (T.isConditionalExpression(n) || T.isIfStatement(n)) decides = true;
    if (T.isPrefixUnaryExpression(n) && n.operator === T.SyntaxKind.ExclamationToken) decides = true;
    if ((T.isPrefixUnaryExpression(n) || T.isPostfixUnaryExpression(n)) && [T.SyntaxKind.PlusPlusToken, T.SyntaxKind.MinusMinusToken].includes(n.operator)) writes = true;
    if (T.isDeleteExpression(n) || T.isAwaitExpression(n)) writes = true;
    if (T.isPropertyAccessExpression(n) && !T.isPropertyAccessExpression(n.parent)) members.add(n.getText().replace(/\?\./g, "."));
    if (T.isIdentifier(n)) {
      const p = n.parent;
      const isMember = p && T.isPropertyAccessExpression(p) && p.name === n;
      const isKey = p && (T.isPropertyAssignment(p) || T.isJsxAttribute(p) || T.isBindingElement(p)) && p.name === n;
      if (!isMember && !isKey) ids.add(n.text);
    }
    T.forEachChild(n, walk);
  };
  walk(expr);
  return { ids: new Set([...ids].filter((i) => !bound.has(i))), members: new Set([...members].filter((m) => !bound.has(m.split(".")[0]))), calls, writes, decides, bound };
}

function identifiersOf(name) {
  const T = ts();
  const out = [];
  const walk = (n) => { if (T.isIdentifier(n)) out.push(n.text); T.forEachChild(n, walk); };
  if (name) walk(name);
  return out;
}

// ---------- fingerprint ----------

export function fingerprint(source, fileName, cfgIn = {}) {
  const T = ts();
  const cfg = { ...DEFAULTS, ...cfgIn };
  const kind = /\.[jt]sx$/.test(fileName) ? T.ScriptKind.TSX : /\.ts$/.test(fileName) ? T.ScriptKind.TS : T.ScriptKind.JS;
  const sf = T.createSourceFile(fileName, source, T.ScriptTarget.Latest, true, kind);
  const fp = { imports: new Map(), contexts: new Map([["", []]]), bindings: new Map(), components: new Set(), uiState: new Set(), paramsBy: new Map() };
  const push = (ctx, s) => { if (!fp.contexts.has(ctx)) fp.contexts.set(ctx, []); fp.contexts.get(ctx).push(s); };

  const addBinding = (key, exprNode) => { if (!fp.bindings.has(key)) fp.bindings.set(key, analyze(exprNode)); };

  const visitJsx = (n) => {
    if (T.isJsxElement(n)) { visitOpening(n.openingElement); n.children.forEach(visitJsxChild); return; }
    if (T.isJsxSelfClosingElement(n)) { visitOpening(n); return; }
    if (T.isJsxFragment(n)) n.children.forEach(visitJsxChild);
  };
  const visitOpening = (el) => {
    for (const a of el.attributes.properties) {
      if (T.isJsxSpreadAttribute(a)) { addBinding(`...${normalize(a.expression, sf, cfg)}`, a.expression); visitInner(a.expression); continue; }
      const name = a.name.getText(sf);
      const expr = a.initializer && T.isJsxExpression(a.initializer) ? a.initializer.expression : null;
      if (attrIgnored(name, cfg) && name !== "dangerouslySetInnerHTML") {
        if (expr) {
          const info = analyze(expr);
          const effectful = info.writes || info.calls.some((c) => !safeCall(c, cfg, new Set()));
          if (effectful) addBinding(`${name}={${normalize(expr, sf, cfg)}}`, expr);
          visitInner(expr);
        }
        continue;
      }
      if (!a.initializer) { addBinding(name, a.name); continue; }
      if (T.isStringLiteral(a.initializer)) {
        // A literal steers behaviour only on attributes that do something.
        if (BEHAVIOUR_ATTR.test(name)) addBinding(`${name}=${JSON.stringify(a.initializer.text)}`, a.initializer);
        continue;
      }
      if (expr) { addBinding(`${name}={${normalize(expr, sf, cfg)}}`, expr); visitInner(expr); }
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
  const visitInner = (expr) => {
    const walk = (n) => { if (isJsx(n)) { visitJsx(n); return; } T.forEachChild(n, walk); };
    walk(expr);
  };

  const header = (name, fn) => `${/^[A-Z]/.test(name) ? "component" : "function"} ${name}(${(fn.parameters || []).map((p) => normalize(p, sf, cfg)).join(", ")})`;

  const fnBody = (fn, name, ctx) => {
    const inner = ctx ? `${ctx} > ${name}` : name;
    if (name && /^[A-Z]/.test(name)) {
      fp.components.add(name);
      fp.paramsBy.set(name, new Set((fn.parameters || []).flatMap((p) => identifiersOf(p.name))));
    }
    if (!fp.contexts.has(inner)) fp.contexts.set(inner, []);
    if (!fn.body) return;
    if (T.isBlock(fn.body)) fn.body.statements.forEach((s) => stmt(s, inner));
    else { push(inner, `=> ${normalize(fn.body, sf, cfg)}`); visitInner(fn.body); }
  };

  const stmt = (s, ctx) => {
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
    if (T.isFunctionDeclaration(s)) { const n = s.name?.text || "(anonymous)"; push(ctx, header(n, s)); fnBody(s, n, ctx); return; }
    if (T.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const init = d.initializer;
        const wrapped = init && T.isCallExpression(init) && ["forwardRef", "memo", "React.forwardRef", "React.memo"].includes(calleeName(init.expression)) ? init.arguments[0] : null;
        const fn = init && (T.isArrowFunction(init) || T.isFunctionExpression(init)) ? init
          : wrapped && (T.isArrowFunction(wrapped) || T.isFunctionExpression(wrapped)) ? wrapped : null;
        const name = d.name.getText(sf);
        if (fn) { push(ctx, header(name, fn)); fnBody(fn, name, ctx); continue; }
        push(ctx, `const ${normalize(d, sf, cfg)}`);
        if (init && T.isCallExpression(init) && cfg.ui_state_hooks.includes(calleeName(init.expression).replace(/^React\./, ""))) {
          const a = init.arguments;
          const literal = a.length === 0 || (a.length === 1 && ([T.SyntaxKind.TrueKeyword, T.SyntaxKind.FalseKeyword, T.SyntaxKind.NullKeyword, T.SyntaxKind.NumericLiteral, T.SyntaxKind.StringLiteral].includes(a[0].kind) || (T.isIdentifier(a[0]) && a[0].text === "undefined")));
          if (literal) for (const id of identifiersOf(d.name)) fp.uiState.add(id);
        }
        if (init) visitInner(init);
      }
      return;
    }
    if (T.isReturnStatement(s)) { push(ctx, `return ${s.expression ? normalize(s.expression, sf, cfg) : ""}`); if (s.expression) visitInner(s.expression); return; }
    if (T.isIfStatement(s)) {
      push(ctx, `if (${normalize(s.expression, sf, cfg)}) {`); visitInner(s.expression); block(s.thenStatement, ctx);
      if (s.elseStatement) { push(ctx, "} else {"); block(s.elseStatement, ctx); }
      push(ctx, "}");
      return;
    }
    if (T.isBlock(s)) { push(ctx, "{"); s.statements.forEach((x) => stmt(x, ctx)); push(ctx, "}"); return; }
    push(ctx, normalize(s, sf, cfg));
    visitInner(s);
  };
  const block = (s, ctx) => (T.isBlock(s) ? s.statements.forEach((x) => stmt(x, ctx)) : stmt(s, ctx));
  sf.statements.forEach((s) => stmt(s, ""));
  return fp;
}

// ---------- comparing two sides ----------

// A view-only hook with a literal start, for every hook in `ui_state_hooks`.
const LITERAL = '(true|false|null|undefined|-?\\d+(\\.\\d+)?|"[^"]*")?';
const uiStateRe = (hooks) => {
  const h = hooks.map((n) => n.replace(/[.$]/g, "\\$&")).join("|");
  return new RegExp(`^const (\\[\\w+, set\\w+\\]|\\w+) = (React\\.)?(${h})(<[^>]*>)?\\(${LITERAL}\\)$`);
};
const BEHAVIOUR_ATTR = /^(on[A-Z]\w*|href|to|type|value|name|action|method|form|formAction|target|download|disabled|checked|selected|defaultValue|defaultChecked|required|pattern|min|max|accept|open|dangerouslySetInnerHTML)(=|$)/;
const GLOBALS = new Set(["true", "false", "null", "undefined", "Boolean", "String", "Number", "Math", "Object", "Array", "JSON"]);

function safeCall(name, cfg, viewOnly) {
  if (cfg.class_helpers.includes(name) || cfg.copy_helpers.includes(name) || cfg.safe_calls.includes(name)) return true;
  if (viewOnly.has(name)) return true; // the new view state's own setter
  const last = name.split(".").pop();
  return name.includes(".") && cfg.safe_calls.includes(last);
}

export function isPresentationalImport(mod, names, file, profile) {
  const b = profile.boundary || {};
  if (mod === "react" || mod === "react/jsx-runtime") return [...names].every((n) => DEFAULTS.react_presentational.includes(n) || n === "default" || n === "*");
  if ((b.presentational_imports || []).some((re) => new RegExp(re).test(mod))) return true;
  let path = null;
  for (const [alias, target] of Object.entries(b.aliases || {})) if (mod === alias || mod.startsWith(alias.endsWith("/") ? alias : `${alias}/`)) path = posix.join(target, mod.slice(alias.length));
  if (!path && mod.startsWith(".")) path = posix.normalize(posix.join(posix.dirname(file), mod));
  if (!path) return false;
  const bare = path.replace(/\.(js|mjs|jsx|ts|tsx)$/, "");
  const cands = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", ""].map((e) => bare + e);
  return cands.some((c) => matchAny(c, b.allow)) && !cands.some((c) => matchAny(c, b.deny));
}

export function compare(baseSrc, headSrc, file, profile = {}) {
  const cfg = { ...DEFAULTS, ...(profile.boundary?.code || {}) };
  const UI_STATE_RE = uiStateRe(cfg.ui_state_hooks);
  if (headSrc === null) return { verdict: "removed", issues: ["deletes a file; a component that people use may disappear with it"], notes: [] };
  const head = fingerprint(headSrc, file, cfg);
  const B = baseSrc === null ? { imports: new Map(), contexts: new Map([["", []]]), bindings: new Map(), components: new Set(), uiState: new Set(), paramsBy: new Map() } : fingerprint(baseSrc, file, cfg);
  const issues = [], notes = [];

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

  // Statements, per function and in order. A new component's body may hold only view
  // state and its markup; an existing function may only gain view state.
  const newState = new Set([...head.uiState].filter((x) => !B.uiState.has(x)));
  const newComponents = new Set([...head.components].filter((x) => !B.components.has(x)));
  const allowedNew = (s) => UI_STATE_RE.test(s) || (/^component (\w+)\(/.test(s) && newComponents.has(s.match(/^component (\w+)/)[1]));
  for (const [ctx, list] of head.contexts) {
    const name = ctx.split(" > ").pop();
    if (!B.contexts.has(ctx)) {
      if (!newComponents.has(name)) { issues.push(`adds code: ${ctx}`); continue; }
      const bad = list.filter((s) => !UI_STATE_RE.test(s) && !/^return (__JSX__|null);?$|^=> (__JSX__|null)$/.test(s) && !(/^component (\w+)\(/.test(s) && newComponents.has(s.match(/^component (\w+)/)[1])));
      if (bad.length) issues.push(`changes code: the new ${name} does more than show things: ${bad[0].slice(0, 140)}`);
      else notes.push(`adds a presentational component ${name}`);
      continue;
    }
    const before = B.contexts.get(ctx);
    const kept = list.filter((s) => !(allowedNew(s) && !before.includes(s)));
    for (const s of list) if (allowedNew(s) && !before.includes(s) && UI_STATE_RE.test(s)) notes.push(`adds view-only state: ${s.replace(/^const /, "")}`);
    if (kept.length !== before.length || kept.some((s, i) => s !== before[i])) {
      const i = kept.findIndex((s, k) => s !== before[k]);
      const at = i < 0 ? Math.min(kept.length, before.length) : i;
      issues.push(`changes code${ctx ? ` in ${ctx}` : ""}: ${(before[at] || "(nothing)").slice(0, 100)} → ${(kept[at] || "(nothing)").slice(0, 100)}`);
    }
  }
  for (const ctx of B.contexts.keys()) if (!head.contexts.has(ctx)) issues.push(`changes code: removes ${ctx}`);

  // Markup bindings.
  const known = new Set([...B.bindings.values()].flatMap((b) => [...b.ids]));
  const knownMembers = new Set([...B.bindings.values()].flatMap((b) => [...b.members]));
  const viewOnly = new Set(newState);
  for (const c of newComponents) for (const p of head.paramsBy.get(c) || []) viewOnly.add(p);
  const removals = [...B.bindings.keys()].filter((k) => !head.bindings.has(k));
  for (const [k, info] of head.bindings) {
    if (B.bindings.has(k)) continue;
    const short = k.slice(0, 140);
    const ids = [...info.ids].filter((id) => !GLOBALS.has(id));
    const external = ids.filter((id) => !viewOnly.has(id) && !head.components.has(id));
    const badCalls = info.calls.filter((c) => !safeCall(c, cfg, viewOnly));
    const shown = (m) => knownMembers.has(m) || [...knownMembers].some((km) => m.startsWith(`${km}.`) || km.startsWith(`${m}.`));
    const newData = [...info.members].filter((m) => !viewOnly.has(m.split(".")[0]) && !shown(m));
    // A fixed value on a behaviour attribute (a link target, a type, disabled) is behaviour.
    const literal = /^[\w-]+="/.test(k) || (!ids.length && !info.calls.length);
    if (badCalls.length) issues.push(`wires new behaviour: ${short} (calls ${badCalls.slice(0, 3).join(", ")})`);
    else if (info.writes) issues.push(`wires new behaviour: ${short} (assigns)`);
    else if (BEHAVIOUR_ATTR.test(k) && literal) issues.push(`adds behaviour to an element: ${short}`);
    else if (BEHAVIOUR_ATTR.test(k) && external.length) issues.push(`wires new behaviour: ${short} (uses ${external.slice(0, 4).join(", ")})`);
    else if (info.decides && external.length) issues.push(`adds a condition on existing data: ${short}`);
    else if (newData.length) issues.push(`shows data the screen did not show before: ${newData.slice(0, 3).join(", ")}`);
    else if (external.some((id) => !known.has(id))) issues.push(`wires new behaviour: ${short} (uses ${external.filter((id) => !known.has(id)).slice(0, 4).join(", ")})`);
    else notes.push(`rewires: ${short}`);
  }
  const verdict = issues.length ? "logic" : removals.length ? "removed" : notes.length ? "ui-state" : "ok";
  if (removals.length) issues.push(...removals.map((k) => `no longer offers: ${k.slice(0, 160)}`));
  return { verdict, issues, notes };
}
