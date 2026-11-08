// The guard for TypeScript and JavaScript with React (lib/guard.mjs picks it by extension).
//
// Each side of a file is reduced to a behaviour fingerprint —
//   imports     modules the file uses that are not presentational;
//   statements  every statement outside the markup, IN ORDER, per function: JSX
//               becomes __JSX__, copy and class strings "__S__", every other string
//               keeps its text (an address, a method, a status is behaviour);
//   bindings    what the markup wires to behaviour, each with its place (function,
//               return, the conditions around it) and its element: handlers, links,
//               values, conditions, lists, data passed to components, every attribute
//               outside the presentational list (literal or not), the components it
//               renders, elements that load or submit (script, iframe, form, …), and
//               what a class or a style reads.
// Markup structure, classes, styles, copy and presentational components are not in it,
// so moving, restyling and rewording leave it unchanged. Anything else that changes is
// a behaviour change, with three tolerated additions: view-only state (useState,
// useRef, useId with a literal start), new presentational components, and new markup
// bindings that read only what the old markup read, call nothing but formatting and
// the new view state's setters, and add no condition on existing data. An action keeps
// its place: one moved under another condition, onto another element, or offered twice
// is a behaviour change.
import { posix } from "node:path";
import { req } from "../core.mjs";
import { matchAny } from "../globs.mjs";
import { cssDangers, styleUrlDangers } from "../css-check.mjs";

export const exts = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;

const ts = () => req("typescript");

export const DEFAULTS = {
  class_helpers: ["cn", "clsx", "cva", "twMerge", "classNames", "cx"],
  copy_helpers: ["t", "i18n.t", "formatMessage"],
  // Attributes whose literal text is presentation or copy; every other attribute is
  // behaviour, literal or not. An expression in them is still judged: one that calls or
  // assigns is behaviour, and what it reads must be on the screen already.
  ignored_attrs: ["className", "class", "style", "key", "id", "title", "role", "tabIndex", "icon", "size", "variant", "tone", "align", "side", "sideOffset", "asChild", "alt", "loading", "placeholder", "label", "description", "aria-*", "data-*",
    // inline SVG drawing
    "width", "height", "viewBox", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "fillRule", "clipRule", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points", "transform", "opacity", "xmlns", "focusable", "preserveAspectRatio"],
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
      if (T.isTaggedTemplateExpression(n)) return n; // a tag's template is its argument: kept as written
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
    if (T.isTaggedTemplateExpression(n)) calls.push(calleeName(n.tag) || "(computed)"); // fn`…` calls fn
    if (T.isDecorator?.(n)) calls.push(calleeName(n.expression) || "(computed)");
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

// Elements that load, run or submit something whatever their attributes say.
const ACTIVE_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "meta", "link", "base", "portal"]);
// A fixed local image may change on src/srcSet/poster (an image is design); another
// host, a query or a non-image is behaviour (a tracker, a GET to an action).
const LOCAL_IMAGE = /^((?![a-z][\w+.-]*:|\/\/)[^?#:\s]+\.(png|jpe?g|gif|webp|svg|avif|ico)|data:image\/(png|jpe?g|gif|webp|avif);base64,[\w+/=]+)$/i;
const localImages = (text) => text.split(",").every((p) => LOCAL_IMAGE.test(p.trim().split(/\s+/)[0] || ""));
const EMPTY = Object.freeze({ ids: new Set(), members: new Set(), calls: [], writes: false, decides: false, bound: new Set() });
const intrinsicTag = (tag) => /^[a-z][\w-]*$/.test(tag);

function isPureLiteral(node) {
  const T = ts();
  let pure = true;
  const walk = (n) => {
    if (!pure || T.isTypeNode(n)) return;
    if (T.isCallExpression(n) || T.isNewExpression(n) || T.isTaggedTemplateExpression(n) || isJsx(n)) { pure = false; return; }
    if (T.isIdentifier(n) && !(n.parent && (T.isPropertyAssignment(n.parent) || T.isPropertyAccessExpression(n.parent)) && n.parent.name === n) && n.text !== "undefined") { pure = false; return; }
    T.forEachChild(n, walk);
  };
  walk(node);
  return pure;
}

export function fingerprint(source, fileName, cfgIn = {}) {
  const T = ts();
  const cfg = { ...DEFAULTS, ...cfgIn };
  const kind = /\.[jt]sx$/.test(fileName) ? T.ScriptKind.TSX : /\.ts$/.test(fileName) ? T.ScriptKind.TS : T.ScriptKind.JS;
  const sf = T.createSourceFile(fileName, source, T.ScriptTarget.Latest, true, kind);
  const fp = { imports: new Map(), locals: new Map(), specifiers: new Set(), contexts: new Map([["", []]]), bindings: [], components: new Set(), componentCtx: new Map(), uiState: new Map(), paramsBy: new Map(), literalConsts: new Set() };
  const push = (ctx, s) => { if (!fp.contexts.has(ctx)) fp.contexts.set(ctx, []); fp.contexts.get(ctx).push(s); };
  const rets = new Map();
  let elSeq = 0;

  // where = { fn, ret, conds: [{ t, ids }] }: the function, which return (or statement)
  // the markup sits in, and the conditions and calls around it, outermost first.
  const add = (kind, key, info, where, el, extra = {}) => fp.bindings.push({ kind, key, info, fn: where.fn, ret: where.ret, conds: where.conds, el, ...extra });
  const within = (where, t, node) => ({ ...where, conds: [...where.conds, { t, ids: [...analyze(node).ids] }] });

  const labelOf = (n) => {
    const out = [];
    const open = T.isJsxElement(n) ? n.openingElement : T.isJsxSelfClosingElement(n) ? n : null;
    if (open) for (const a of open.attributes.properties) if (T.isJsxAttribute(a) && /^(aria-label|title|label)$/.test(a.name.getText(sf)) && a.initializer && T.isStringLiteral(a.initializer)) out.push(a.initializer.text);
    const kids = (x) => {
      for (const c of x.children || []) {
        if (T.isJsxText(c)) { const t = c.text.trim().replace(/\s+/g, " "); if (t) out.push(t); }
        else if (T.isJsxExpression(c) && c.expression) {
          if (T.isStringLiteral(c.expression) || T.isNoSubstitutionTemplateLiteral(c.expression)) out.push(c.expression.text);
          else if (T.isCallExpression(c.expression) && cfg.copy_helpers.includes(calleeName(c.expression.expression))) out.push(c.expression.getText(sf));
        } else if (T.isJsxElement(c) || T.isJsxSelfClosingElement(c)) {
          const tg = (T.isJsxElement(c) ? c.openingElement : c).tagName.getText(sf);
          if (!intrinsicTag(tg)) out.push(`<${tg}>`);
          if (T.isJsxElement(c)) kids(c);
        } else if (T.isJsxFragment(c)) kids(c);
      }
    };
    if (T.isJsxElement(n)) kids(n);
    return out.join(" ");
  };

  const visitJsx = (n, where, inForm) => {
    if (T.isJsxFragment(n)) { n.children.forEach((c) => visitJsxChild(c, where, inForm)); return; }
    const open = T.isJsxElement(n) ? n.openingElement : n;
    const tag = open.tagName.getText(sf);
    const intrinsic = intrinsicTag(tag);
    const el = { id: elSeq++, tag, label: labelOf(n) };
    if (intrinsic && ACTIVE_TAGS.has(tag)) add("element", `<${tag}>`, EMPTY, where, el);
    if (!intrinsic) add("tag", `<${tag}>`, EMPTY, where, el, { tag });
    visitOpening(open, where, el, intrinsic, inForm);
    if (T.isJsxElement(n)) {
      if (tag === "style") for (const d of cssDangers(n.children.map((c) => c.getText(sf)).join(""))) add("element", `<style> ${d}`, EMPTY, where, el);
      const f = inForm || tag === "form";
      n.children.forEach((c) => visitJsxChild(c, where, f));
    }
  };
  const visitOpening = (open, where, el, intrinsic, inForm) => {
    let typed = false;
    for (const a of open.attributes.properties) {
      if (T.isJsxSpreadAttribute(a)) { add("attr", `...${normalize(a.expression, sf, cfg)}`, analyze(a.expression), where, el, { behaviour: true }); visitInner(a.expression, where, inForm); continue; }
      const name = a.name.getText(sf);
      if (name === "type") typed = true;
      const expr = a.initializer && T.isJsxExpression(a.initializer) ? a.initializer.expression : null;
      if (attrIgnored(name, cfg) && name !== "dangerouslySetInnerHTML") {
        if (expr) {
          const info = analyze(expr);
          const effectful = info.writes || info.calls.some((c) => !safeCall(c, cfg, new Set()));
          // What a class or a style reads is shown (or leaked) as surely as a child is.
          add(effectful ? "attr" : "read", `${name}={${normalize(expr, sf, cfg)}}`, info, where, el, { behaviour: effectful });
          if (name === "style") for (const u of styleUrlDangers(expr.getText(sf))) add("element", `style loads ${u}`, EMPTY, where, el);
          visitInner(expr, where, inForm);
        }
        continue;
      }
      if (!a.initializer) { add("attr", name, EMPTY, where, el, { behaviour: true, literal: true }); continue; }
      if (T.isStringLiteral(a.initializer)) {
        if (/^(src|srcSet|poster)$/.test(name) && localImages(a.initializer.text)) continue;
        // type="button" only keeps a button from submitting: it does nothing itself.
        if (name === "type" && a.initializer.text === "button" && /^(button|Button)$/.test(el.tag)) continue;
        add("attr", `${name}=${JSON.stringify(a.initializer.text)}`, EMPTY, where, el, { behaviour: true, literal: true });
        continue;
      }
      if (expr) {
        const info = analyze(expr);
        const literal = !info.ids.size && !info.calls.length && !info.members.size;
        add("attr", `${name}={${normalize(expr, sf, cfg)}}`, info, where, el, { behaviour: intrinsic || literal || BEHAVIOUR_ATTR.test(name), literal });
        visitInner(expr, where, inForm);
      } else if (a.initializer && isJsx(a.initializer)) visitJsx(a.initializer, where, inForm);
    }
    // A button with no type inside a form submits it.
    if (intrinsic && el.tag === "button" && inForm && !typed) add("attr", 'type="submit"', EMPTY, where, el, { behaviour: true, literal: true });
  };
  const visitJsxChild = (c, where, inForm) => {
    if (T.isJsxText(c)) return;
    if (T.isJsxExpression(c)) {
      if (!c.expression) return;
      if (!(T.isStringLiteral(c.expression) || T.isNoSubstitutionTemplateLiteral(c.expression))) add("child", `{${normalize(c.expression, sf, cfg)}}`, analyze(c.expression), where, null);
      visitInner(c.expression, where, inForm);
      return;
    }
    visitJsx(c, where, inForm);
  };
  const visitInner = (expr, where, inForm = false) => {
    const walk = (n, w) => {
      if (isJsx(n)) { visitJsx(n, w, inForm); return; }
      if (T.isConditionalExpression(n)) {
        const t = normalize(n.condition, sf, cfg);
        walk(n.condition, w); walk(n.whenTrue, within(w, `${t} ?`, n.condition)); walk(n.whenFalse, within(w, `${t} :`, n.condition));
        return;
      }
      if (T.isBinaryExpression(n) && [T.SyntaxKind.AmpersandAmpersandToken, T.SyntaxKind.BarBarToken, T.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) {
        walk(n.left, w); walk(n.right, within(w, `${normalize(n.left, sf, cfg)} ${n.operatorToken.getText(sf)}`, n.left));
        return;
      }
      if (T.isCallExpression(n)) {
        walk(n.expression, w);
        const inner = within(w, `${calleeName(n.expression) || "(computed)"}()`, n.expression);
        n.arguments.forEach((x) => walk(x, inner));
        return;
      }
      T.forEachChild(n, (x) => walk(x, w));
    };
    walk(expr, where);
  };
  const at = (ctx, ret) => ({ fn: ctx, ret, conds: [] });
  const nextRet = (ctx) => { const k = rets.get(ctx) || 0; rets.set(ctx, k + 1); return `return#${k}`; };

  const header = (name, fn) => `${/^[A-Z]/.test(name) ? "component" : "function"} ${name}(${(fn.parameters || []).map((p) => normalize(p, sf, cfg)).join(", ")})`;

  const fnBody = (fn, name, ctx) => {
    const inner = ctx ? `${ctx} > ${name}` : name;
    if (name && /^[A-Z]/.test(name)) {
      fp.components.add(name);
      fp.componentCtx.set(name, inner);
      fp.paramsBy.set(inner, new Set((fn.parameters || []).flatMap((p) => identifiersOf(p.name))));
    }
    if (!fp.contexts.has(inner)) fp.contexts.set(inner, []);
    if (!fn.body) return;
    if (T.isBlock(fn.body)) fn.body.statements.forEach((s) => stmt(s, inner));
    else { push(inner, `=> ${normalize(fn.body, sf, cfg)}`); visitInner(fn.body, at(inner, nextRet(inner))); }
  };

  const stmt = (s, ctx) => {
    if (T.isImportDeclaration(s)) {
      fp.specifiers.add(s.moduleSpecifier.text);
      if (s.importClause?.isTypeOnly) return;
      const mod = s.moduleSpecifier.text;
      const names = [];
      const ic = s.importClause;
      if (ic?.name) { names.push("default"); fp.locals.set(ic.name.text, { mod, name: "default" }); }
      if (ic?.namedBindings) {
        if (T.isNamespaceImport(ic.namedBindings)) { names.push("*"); fp.locals.set(ic.namedBindings.name.text, { mod, name: "*" }); }
        else for (const e of ic.namedBindings.elements) if (!e.isTypeOnly) { names.push((e.propertyName || e.name).text); fp.locals.set(e.name.text, { mod, name: (e.propertyName || e.name).text }); }
      }
      if (!ic) names.push("(side effect)");
      fp.imports.set(mod, new Set([...(fp.imports.get(mod) || []), ...names]));
      return;
    }
    if (T.isTypeAliasDeclaration(s) || T.isInterfaceDeclaration(s)) return;
    if (T.isExportDeclaration(s) && s.isTypeOnly) return;
    if (T.isExportDeclaration(s) && s.moduleSpecifier) fp.specifiers.add(s.moduleSpecifier.text);
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
          if (literal) {
            if (!fp.uiState.has(ctx)) fp.uiState.set(ctx, new Set());
            for (const id of identifiersOf(d.name)) fp.uiState.get(ctx).add(id);
          }
        }
        if (init && s.declarationList.flags & T.NodeFlags.Const && T.isIdentifier(d.name) && isPureLiteral(init)) fp.literalConsts.add(d.name.text);
        if (init) visitInner(init, at(ctx, `const ${name}`));
      }
      return;
    }
    if (T.isReturnStatement(s)) { push(ctx, `return ${s.expression ? normalize(s.expression, sf, cfg) : ""}`); if (s.expression) visitInner(s.expression, at(ctx, nextRet(ctx))); return; }
    if (T.isIfStatement(s)) {
      push(ctx, `if (${normalize(s.expression, sf, cfg)}) {`); visitInner(s.expression, at(ctx, "")); block(s.thenStatement, ctx);
      if (s.elseStatement) { push(ctx, "} else {"); block(s.elseStatement, ctx); }
      push(ctx, "}");
      return;
    }
    if (T.isBlock(s)) { push(ctx, "{"); s.statements.forEach((x) => stmt(x, ctx)); push(ctx, "}"); return; }
    push(ctx, normalize(s, sf, cfg));
    visitInner(s, at(ctx, ""));
  };
  const block = (s, ctx) => (T.isBlock(s) ? s.statements.forEach((x) => stmt(x, ctx)) : stmt(s, ctx));
  sf.statements.forEach((s) => stmt(s, ""));
  // Dynamic imports and require() reach code as surely as an import does.
  const dyn = (n) => {
    if (T.isCallExpression(n) && n.arguments.length && T.isStringLiteral(n.arguments[0]) && (n.expression.kind === T.SyntaxKind.ImportKeyword || calleeName(n.expression) === "require")) fp.specifiers.add(n.arguments[0].text);
    T.forEachChild(n, dyn);
  };
  dyn(sf);
  return fp;
}

// ---------- comparing two sides ----------

// A view-only hook with a literal start, for every hook in `ui_state_hooks`.
const LITERAL = '(true|false|null|undefined|-?\\d+(\\.\\d+)?|"[^"]*")?';
const uiStateRe = (hooks) => {
  const h = hooks.map((n) => n.replace(/[.$]/g, "\\$&")).join("|");
  return new RegExp(`^const (\\[\\w+, set\\w+\\]|\\w+) = (React\\.)?(${h})(<[^>]*>)?\\(${LITERAL}\\)$`);
};
const BEHAVIOUR_ATTR = /^(on[A-Z]\w*|href|to|type|value|name|action|method|form|formAction|formMethod|target|download|ping|rel|src|srcDoc|srcSet|httpEquiv|disabled|noValidate|formNoValidate|inert|checked|selected|defaultValue|defaultChecked|required|pattern|min|max|accept|open|dangerouslySetInnerHTML)(=|$)/;
const HANDLER = /^(on[A-Z]\w*|href|to|action|formAction|\.\.\.)/;
const GLOBALS = new Set(["true", "false", "null", "undefined", "Boolean", "String", "Number", "Math", "Object", "Array", "JSON"]);

function safeCall(name, cfg, viewOnly) {
  if (cfg.class_helpers.includes(name) || cfg.copy_helpers.includes(name) || cfg.safe_calls.includes(name)) return true;
  if (viewOnly.has(name)) return true; // the new view state's own setter
  const last = name.split(".").pop();
  return name.includes(".") && cfg.safe_calls.includes(last);
}

// The repository path (without extension) an import specifier names, or null for a package.
export function resolveImport(mod, file, profile) {
  const b = profile.boundary || {};
  for (const [alias, target] of Object.entries(b.aliases || {})) if (mod === alias || mod.startsWith(alias.endsWith("/") ? alias : `${alias}/`)) return posix.join(target, mod.slice(alias.length)).replace(/\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/, "");
  if (mod.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), mod)).replace(/\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/, "");
  return null;
}
export const IMPORT_EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js", ""];

export function isPresentationalImport(mod, names, file, profile) {
  const b = profile.boundary || {};
  if (mod === "react" || mod === "react/jsx-runtime") return [...names].every((n) => DEFAULTS.react_presentational.includes(n) || n === "default" || n === "*");
  if ((b.presentational_imports || []).some((re) => new RegExp(re).test(mod))) return true;
  const bare = resolveImport(mod, file, profile);
  if (!bare) return false;
  const cands = IMPORT_EXTS.map((e) => bare + e);
  return cands.some((c) => matchAny(c, b.allow)) && !cands.some((c) => matchAny(c, b.deny));
}

// A component tag may be rendered in a new place only when it shows things: a new
// presentational component of this file or of this diff, React's own, or an import the
// profile names presentational. A path on the allow list is not enough.
function presentationalTag(tag, fp, newPres, file, profile, presFiles) {
  const root = tag.split(".")[0];
  if (newPres.has(root)) return true;
  const imp = fp.locals.get(root);
  if (!imp) return false;
  const b = profile.boundary || {};
  if (imp.mod === "react" || imp.mod === "react/jsx-runtime") return isPresentationalImport(imp.mod, new Set([tag.includes(".") ? tag.split(".")[1] : imp.name]), file, profile);
  if ((b.presentational_imports || []).some((re) => new RegExp(re).test(imp.mod))) return true;
  const bare = resolveImport(imp.mod, file, profile);
  return !!bare && IMPORT_EXTS.some((e) => presFiles.has(bare + e));
}

const EMPTY_FP = () => ({ imports: new Map(), locals: new Map(), specifiers: new Set(), contexts: new Map([["", []]]), bindings: [], components: new Set(), componentCtx: new Map(), uiState: new Map(), paramsBy: new Map(), literalConsts: new Set() });
const prefixes = (ctx) => (ctx ? ctx.split(" > ").map((_, i, a) => a.slice(0, i + 1).join(" > ")) : []);
const tally = (list, f) => list.reduce((m, e) => m.set(f(e), (m.get(f(e)) || 0) + 1), new Map());

export function compare(baseSrc, headSrc, file, profile = {}, opts = {}) {
  const cfg = { ...DEFAULTS, ...(profile.boundary?.code || {}) };
  const presFiles = opts.presentationalFiles || new Set();
  const UI_STATE_RE = uiStateRe(cfg.ui_state_hooks);
  if (headSrc === null) return { verdict: "removed", issues: ["deletes a file; a component that people use may disappear with it"], notes: [] };
  const head = fingerprint(headSrc, file, cfg);
  const B = baseSrc === null ? EMPTY_FP() : fingerprint(baseSrc, file, cfg);
  const issues = [], notes = [], removals = [];

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
  const newComponents = new Set([...head.components].filter((x) => !B.components.has(x)));
  const newPres = new Set();
  const allowedNew = (s) => UI_STATE_RE.test(s) || (/^component (\w+)\(/.test(s) && newComponents.has(s.match(/^component (\w+)/)[1]));
  for (const [ctx, list] of head.contexts) {
    const name = ctx.split(" > ").pop();
    if (!B.contexts.has(ctx)) {
      if (!newComponents.has(name)) { issues.push(`adds code: ${ctx}`); continue; }
      const bad = list.filter((s) => !UI_STATE_RE.test(s) && !/^return (__JSX__|null);?$|^=> (__JSX__|null)$/.test(s) && !(/^component (\w+)\(/.test(s) && newComponents.has(s.match(/^component (\w+)/)[1])));
      if (bad.length) issues.push(`changes code: the new ${name} does more than show things: ${bad[0].slice(0, 140)}`);
      else { notes.push(`adds a presentational component ${name}`); newPres.add(name); }
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

  // View-only names belong to the function that declares them (and what it encloses):
  // new view state of that function, and the parameters of a new component.
  const newStateOf = (ctx) => { const h = head.uiState.get(ctx) || new Set(), b = B.uiState.get(ctx) || new Set(); return [...h].filter((x) => !b.has(x)); };
  const voCache = new Map();
  const viewOnlyFor = (fn) => {
    if (!voCache.has(fn)) {
      const s = new Set();
      for (const c of prefixes(fn)) {
        for (const x of newStateOf(c)) s.add(x);
        if (newComponents.has(c.split(" > ").pop())) for (const p of head.paramsBy.get(c) || []) s.add(p);
      }
      voCache.set(fn, s);
    }
    return voCache.get(fn);
  };
  // A condition on new view state only (open/closed) is not a place: it is stripped on
  // the new side, so wrapping markup in a disclosure keeps every binding where it was.
  const scopeOf = (e, side) => {
    const vo = side === "head" ? new Set(newStateOf(e.fn).concat(...prefixes(e.fn).map(newStateOf))) : new Set();
    const conds = e.conds.filter((c) => !(c.ids.length && c.ids.every((id) => vo.has(id)))).map((c) => c.t);
    return `${e.fn}|${e.ret}|${conds.join(" / ")}`;
  };
  const HB = head.bindings.map((e) => ({ ...e, scope: scopeOf(e, "head") }));
  const BB = B.bindings.map((e) => ({ ...e, scope: scopeOf(e, "base") }));
  const known = new Map(), knownMembers = new Map();
  const knownFor = (fn, m) => {
    if (!m.has(fn)) {
      const ctxs = new Set(["", ...prefixes(fn)]);
      const pick = m === known ? (b) => [...b.info.ids] : (b) => [...b.info.members];
      m.set(fn, new Set(BB.filter((b) => ctxs.has(b.fn)).flatMap(pick)));
    }
    return m.get(fn);
  };
  const exemptRoot = (id) => GLOBALS.has(id) || CLASS_VAR.test(id) || head.literalConsts.has(id) || head.components.has(id)
    || cfg.class_helpers.includes(id) || cfg.copy_helpers.includes(id) || cfg.safe_calls.includes(id)
    || (head.locals.has(id) && isPresentationalImport(head.locals.get(id).mod, new Set([head.locals.get(id).name]), file, profile));

  // The rules for a binding the old markup did not have.
  const judgeNew = (e) => {
    const { key: k, info } = e;
    const short = k.slice(0, 140);
    const vo = viewOnlyFor(e.fn);
    const kn = knownFor(e.fn, known), km = knownFor(e.fn, knownMembers);
    const ids = [...info.ids].filter((id) => !GLOBALS.has(id));
    const external = ids.filter((id) => !vo.has(id) && !head.components.has(id));
    const badCalls = info.calls.filter((c) => !safeCall(c, cfg, vo));
    const shown = (m) => km.has(m) || [...km].some((x) => m.startsWith(`${x}.`) || x.startsWith(`${m}.`));
    const newData = [...info.members].filter((m) => !vo.has(m.split(".")[0]) && !shown(m));
    if (e.kind === "read") {
      const unknown = ids.filter((id) => !vo.has(id) && !kn.has(id) && !exemptRoot(id));
      const unseen = newData.filter((m) => !exemptRoot(m.split(".")[0]));
      if (unseen.length) return issues.push(`shows data the screen did not show before: ${unseen.slice(0, 3).join(", ")} (in ${short})`);
      if (unknown.length) return issues.push(`reads what the screen did not read before: ${unknown.slice(0, 4).join(", ")} (in ${short})`);
      return;
    }
    if (badCalls.length) issues.push(`wires new behaviour: ${short} (calls ${badCalls.slice(0, 3).join(", ")})`);
    else if (info.writes) issues.push(`wires new behaviour: ${short} (assigns)`);
    else if (e.behaviour && (e.literal || !ids.length)) issues.push(`adds behaviour to an element: ${short}`);
    else if (e.behaviour && external.length) issues.push(`wires new behaviour: ${short} (uses ${external.slice(0, 4).join(", ")})`);
    else if (info.decides && external.length) issues.push(`adds a condition on existing data: ${short}`);
    else if (newData.length) issues.push(`shows data the screen did not show before: ${newData.slice(0, 3).join(", ")}`);
    else if (external.some((id) => !kn.has(id))) issues.push(`wires new behaviour: ${short} (uses ${external.filter((id) => !kn.has(id)).slice(0, 4).join(", ")})`);
    else notes.push(`rewires: ${short}`);
  };

  // Reads in classes and styles: free to move, but what they read must be on the screen.
  const baseReads = new Set(BB.filter((b) => b.kind === "read").map((b) => `${b.fn}|${b.key}`));
  for (const e of HB.filter((x) => x.kind === "read")) if (!baseReads.has(`${e.fn}|${e.key}`)) judgeNew(e);

  // Children and data passed to components (shown, not acted on): a key the old markup
  // had may move within its function and return, but not out from under a condition.
  const isSet = (e) => e.kind === "child" || (e.kind === "attr" && !e.behaviour);
  const baseSet = BB.filter(isSet), headSet = HB.filter(isSet);
  const sub = (a, b) => { const bs = new Set(b.conds.map((c) => c.t)); return a.conds.every((c) => bs.has(c.t)); };
  for (const e of headSet) {
    const same = baseSet.filter((b) => b.key === e.key);
    if (!same.length) { judgeNew(e); continue; }
    const vo = new Set(prefixes(e.fn).flatMap(newStateOf));
    const eStripped = { conds: e.conds.filter((c) => !(c.ids.length && c.ids.every((id) => vo.has(id)))) };
    if (!same.some((b) => b.fn === e.fn && b.ret === e.ret && sub(b, eStripped))) issues.push(`moves ${e.key.slice(0, 100)} to another place or out from under its condition (${e.scope.split("|").pop() || "none"})`);
  }
  const headSetKeys = new Set(headSet.map((e) => e.key));
  for (const b of baseSet) if (!headSetKeys.has(b.key) && !HB.some((e) => e.key === b.key)) removals.push(b.key);

  // Actions, active elements and components: counted per place, so one moved under
  // another condition, offered twice, or swapped onto another element shows.
  const counted = (e) => (e.kind === "attr" && e.behaviour) || e.kind === "element" || e.kind === "tag";
  const BC = BB.filter(counted), HC = HB.filter(counted);
  const placeCount = { b: tally(BC, (e) => `${e.scope}#${e.key}`), h: tally(HC, (e) => `${e.scope}#${e.key}`) };
  const total = { b: tally(BC, (e) => e.key), h: tally(HC, (e) => e.key) };
  const baseTagged = new Set(BC.map((e) => e.key));
  const seen = new Map();
  for (const e of HC) {
    const pk = `${e.scope}#${e.key}`;
    seen.set(pk, (seen.get(pk) || 0) + 1);
    if (seen.get(pk) <= (placeCount.b.get(pk) || 0)) continue;
    const short = e.key.slice(0, 120);
    if (e.kind === "tag") {
      if (presentationalTag(e.tag, head, newPres, file, profile, presFiles)) continue;
      if (baseTagged.has(e.key)) issues.push(`${(placeCount.b.get(pk) || 0) ? "renders another" : "moves"} ${short} to another place or condition; it may act`);
      else issues.push(`renders ${short}, which this file did not render before; it may act (only presentational components may be added)`);
      continue;
    }
    if (e.kind === "element") { issues.push(`adds ${short}: it loads, runs or submits something`); continue; }
    if (!baseTagged.has(e.key)) { judgeNew(e); continue; }
    if ((total.h.get(e.key) || 0) > (total.b.get(e.key) || 0)) issues.push(`offers ${short} in one more place`);
    else issues.push(`moves ${short} to another place or condition`);
  }
  for (const [k, n] of total.b) {
    if ((total.h.get(k) || 0) >= n) continue;
    const b = BC.find((x) => x.key === k);
    if (b.kind === "tag" && presentationalTag(b.tag, B, new Set(), file, profile, presFiles)) continue;
    removals.push(k);
  }

  // Each element's actions travel together. An element whose set of actions is new,
  // made from actions other elements had, has had an action moved onto it; an element
  // that keeps its actions but carries another action's copy has had its action swapped.
  const elements = (list) => {
    const m = new Map();
    for (const e of list) if (e.el && e.kind === "attr" && e.behaviour) {
      if (!m.has(e.el.id)) m.set(e.el.id, { scope: e.scope, tag: e.el.tag, label: e.el.label, keys: [] });
      m.get(e.el.id).keys.push(e.key);
    }
    return [...m.values()].map((x) => ({ ...x, sig: `${x.scope}#${[...x.keys].sort().join(" ")}` }));
  };
  const bEls = elements(BC), hEls = elements(HC);
  const bSig = tally(bEls, (x) => x.sig), used = new Map();
  const extraH = hEls.filter((x) => { const n = (used.get(x.sig) || 0) + 1; used.set(x.sig, n); return n > (bSig.get(x.sig) || 0); });
  const hSig = tally(hEls, (x) => x.sig); used.clear();
  const spareB = bEls.filter((x) => { const n = (used.get(x.sig) || 0) + 1; used.set(x.sig, n); return n > (hSig.get(x.sig) || 0); });
  const baseKeys = new Set(bEls.flatMap((x) => x.keys));
  for (const h of extraH) {
    let best = null, score = 0;
    for (const b of spareB) {
      if (b.scope !== h.scope) continue;
      const s = h.keys.reduce((n, k) => n + (b.keys.includes(k) ? (HANDLER.test(k) ? 10 : 1) : 0), 0) + (b.tag === h.tag ? 1 : 0);
      if (s > score) { score = s; best = b; }
    }
    if (best) spareB.splice(spareB.indexOf(best), 1);
    const moved = h.keys.filter((k) => !(best?.keys || []).includes(k) && baseKeys.has(k));
    if (moved.length) issues.push(`moves ${moved[0].slice(0, 100)} onto another element (<${h.tag}>${h.label ? ` "${h.label.slice(0, 40)}"` : ""})`);
  }
  for (const h of hEls) {
    if (!h.label) continue;
    const same = bEls.filter((b) => b.sig === h.sig);
    if (!same.length || same.some((b) => b.label === h.label)) continue;
    const other = bEls.find((b) => b.sig !== h.sig && b.label === h.label && b.keys.some((k) => HANDLER.test(k)));
    if (other) issues.push(`puts the copy "${h.label.slice(0, 40)}" on another action (${h.keys.filter((k) => HANDLER.test(k))[0] || h.keys[0]}); it did ${other.keys.filter((k) => HANDLER.test(k))[0] || other.keys[0]}`);
  }

  const verdict = issues.length ? "logic" : removals.length ? "removed" : notes.length ? "ui-state" : "ok";
  if (removals.length) issues.push(...[...new Set(removals)].map((k) => `no longer offers: ${k.slice(0, 160)}`));
  return { verdict, issues, notes };
}
