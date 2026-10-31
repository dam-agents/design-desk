// What can make a component look different: the raw material of a state sheet.
// For one exported component it lists, with the TypeScript checker's own types —
//   props       each prop, its type, whether it is optional, and its values when the
//               type is a union of literals (or a boolean);
//   reads       every `prop.field…` chain the component reads, with the same detail —
//               the fields of an object prop that actually change the output;
//   conditions  every condition the markup and the early returns branch on;
//   hooks       the hooks it calls and what they return: in a state sheet their value
//               comes from a mock, so each is a dimension of its own;
//   children    the components it renders, so a sheet can follow one level down.
// It enumerates; it does not choose. The agent picks the states that matter.
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { req } from "./core.mjs";

const ts = () => req("typescript");

function compilerOptions(tsconfig) {
  const T = ts();
  const base = { jsx: T.JsxEmit.ReactJSX, allowJs: true, skipLibCheck: true, noEmit: true, strict: true, target: T.ScriptTarget.ES2022, module: T.ModuleKind.ESNext, moduleResolution: T.ModuleResolutionKind.Bundler };
  if (!tsconfig || !existsSync(tsconfig)) return base;
  const read = T.readConfigFile(tsconfig, T.sys.readFile);
  if (read.error) return base;
  const parsed = T.parseJsonConfigFileContent(read.config, T.sys, dirname(tsconfig));
  return { ...parsed.options, noEmit: true, skipLibCheck: true };
}

function describeType(checker, type, depth = 0) {
  const T = ts();
  const text = checker.typeToString(type, undefined, T.TypeFormatFlags.NoTruncation).slice(0, 300);
  const out = { type: text };
  const parts = type.isUnion() ? type.types : [type];
  const values = [];
  let open = false;
  for (const p of parts) {
    if (p.isStringLiteral() || p.isNumberLiteral()) values.push(p.value);
    else if (p.flags & T.TypeFlags.BooleanLiteral) values.push(checker.typeToString(p) === "true");
    else if (p.flags & (T.TypeFlags.Undefined | T.TypeFlags.Null)) values.push(p.flags & T.TypeFlags.Null ? null : "undefined");
    else open = true;
  }
  if (values.length && !open) out.values = [...new Set(values)];
  else if (values.length) out.also = [...new Set(values)];
  return out;
}

// A minimal valid value of a type, so a state sheet starts from a complete fixture and
// each tile changes only what makes its state: required fields filled with the empty
// value of their type, optional ones left out, a union's first concrete member.
function fixtureOf(checker, type, depth = 0, seen = new Set()) {
  const T = ts();
  if (depth > 5) return null;
  if (type.isUnion()) {
    const parts = type.types.filter((p) => !(p.flags & (T.TypeFlags.Undefined | T.TypeFlags.Null | T.TypeFlags.Void)));
    if (!parts.length) return null;
    // An optional-ish object (`X | null`, `X | undefined`) starts absent: the quiet state.
    if (parts.length < type.types.length && !parts.some((p) => p.isLiteral() || p.flags & T.TypeFlags.BooleanLiteral)) return null;
    const lit = parts.find((p) => p.isStringLiteral() || p.isNumberLiteral());
    if (lit) return lit.value;
    if (parts.every((p) => p.flags & T.TypeFlags.BooleanLiteral)) return false;
    return fixtureOf(checker, parts[0], depth, seen);
  }
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value;
  if (type.flags & T.TypeFlags.BooleanLiteral) return checker.typeToString(type) === "true";
  if (type.flags & (T.TypeFlags.String | T.TypeFlags.TemplateLiteral)) return "";
  if (type.flags & (T.TypeFlags.Number | T.TypeFlags.BigInt)) return 0;
  if (type.flags & T.TypeFlags.Boolean) return false;
  if (type.flags & (T.TypeFlags.Null | T.TypeFlags.Undefined | T.TypeFlags.Void | T.TypeFlags.Any | T.TypeFlags.Unknown)) return null;
  if (type.getCallSignatures().length) return null;
  if (checker.isArrayType(type) || checker.isTupleType(type)) return [];
  const name = checker.typeToString(type);
  if (name === "Date") return "2026-10-30T12:00:00Z";
  if (seen.has(type)) return {};
  const next = new Set(seen).add(type);
  const out = {};
  for (const sym of type.getProperties()) {
    if (sym.flags & T.SymbolFlags.Optional) continue;
    const decl = sym.valueDeclaration || sym.declarations?.[0];
    const t = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : checker.getDeclaredTypeOfSymbol(sym);
    const v = fixtureOf(checker, t, depth + 1, next);
    out[sym.name] = v;
  }
  return out;
}

export function componentStates(file, { exportName = "", tsconfig = "", root = "" } = {}) {
  const T = ts();
  const program = T.createProgram([file], compilerOptions(tsconfig));
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error(`cannot read ${file}`);

  // The component: the named export, else the only exported PascalCase function.
  const candidates = [];
  const visitTop = (n) => {
    if (T.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text) && n.modifiers?.some((m) => m.kind === T.SyntaxKind.ExportKeyword)) candidates.push({ name: n.name.text, fn: n });
    if (T.isVariableStatement(n) && n.modifiers?.some((m) => m.kind === T.SyntaxKind.ExportKeyword))
      for (const d of n.declarationList.declarations)
        if (T.isIdentifier(d.name) && /^[A-Z]/.test(d.name.text) && d.initializer && (T.isArrowFunction(d.initializer) || T.isFunctionExpression(d.initializer))) candidates.push({ name: d.name.text, fn: d.initializer });
  };
  sf.statements.forEach(visitTop);
  const pick = exportName ? candidates.find((c) => c.name === exportName) : candidates.length === 1 ? candidates[0] : null;
  if (!pick) throw new Error(exportName ? `${file} exports no component ${exportName}` : `${file} exports ${candidates.length} components (${candidates.map((c) => c.name).join(", ")}); name one with --export`);
  const fn = pick.fn;

  // Props: from the first parameter's type.
  const props = [], fixture = {};
  const param = fn.parameters[0];
  const propNames = new Map(); // local binding name → prop name
  if (param) {
    const ptype = checker.getTypeAtLocation(param);
    for (const sym of ptype.getProperties()) {
      const t = checker.getTypeOfSymbolAtLocation(sym, param);
      const optional = Boolean(sym.flags & T.SymbolFlags.Optional);
      props.push({ name: sym.name, optional, ...describeType(checker, t) });
      if (!optional) fixture[sym.name] = fixtureOf(checker, t);
    }
    if (T.isObjectBindingPattern(param.name)) for (const el of param.name.elements) propNames.set(el.name.getText(sf), (el.propertyName || el.name).getText(sf));
    else if (T.isIdentifier(param.name)) propNames.set(param.name.text, "*");
  }

  const reads = new Map(), conditions = [], hooks = new Map(), children = new Set();
  const rootName = (expr) => { let e = expr; while (T.isPropertyAccessExpression(e) || T.isElementAccessExpression(e) || T.isNonNullExpression(e)) e = e.expression; return T.isIdentifier(e) ? e.text : null; };
  const walk = (n) => {
    if (T.isPropertyAccessExpression(n) && !T.isPropertyAccessExpression(n.parent) && !(T.isCallExpression(n.parent) && n.parent.expression === n)) {
      const r = rootName(n);
      if (r && propNames.has(r)) {
        const key = n.getText(sf).replace(/\?\./g, ".").replace(/!/g, "");
        if (!reads.has(key)) reads.set(key, describeType(checker, checker.getTypeAtLocation(n)));
      }
    }
    if (T.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (/^use[A-Z]/.test(callee.split(".").pop()) && !/^React\.use(State|Ref|Id|Memo|Callback|Effect)$|^use(State|Ref|Id|Memo|Callback|Effect|LayoutEffect|Context)$/.test(callee)) {
        const sym = checker.getSymbolAtLocation(T.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression);
        const decl = sym && (sym.flags & T.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym).declarations?.[0];
        const from = decl ? relative(root || dirname(file), decl.getSourceFile().fileName) : "";
        if (!hooks.has(callee)) hooks.set(callee, { name: callee, module: from, ...describeType(checker, checker.getTypeAtLocation(n)) });
      }
    }
    if ((T.isBinaryExpression(n) && [T.SyntaxKind.AmpersandAmpersandToken, T.SyntaxKind.BarBarToken, T.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind) && T.isJsxExpression(n.parent)) || T.isConditionalExpression(n)) {
      conditions.push((T.isConditionalExpression(n) ? n.condition : n.left).getText(sf).replace(/\s+/g, " ").slice(0, 200));
    }
    if (T.isIfStatement(n) && n.thenStatement && (T.isReturnStatement(n.thenStatement) || (T.isBlock(n.thenStatement) && n.thenStatement.statements.some(T.isReturnStatement))))
      conditions.push(`early return: ${n.expression.getText(sf).replace(/\s+/g, " ").slice(0, 200)}`);
    if ((T.isJsxOpeningElement(n) || T.isJsxSelfClosingElement(n)) && /^[A-Z]/.test(n.tagName.getText(sf))) children.add(n.tagName.getText(sf));
    T.forEachChild(n, walk);
  };
  walk(fn);
  return {
    component: pick.name, file: root ? relative(root, file) : file,
    props, fixture, reads: [...reads].map(([expr, d]) => ({ expr, ...d })),
    conditions: [...new Set(conditions)], hooks: [...hooks.values()], children: [...children],
  };
}

export const findTsconfig = (file, stop = "/") => {
  for (let d = dirname(file); d.startsWith(stop) && d !== dirname(d); d = dirname(d)) {
    for (const n of ["tsconfig.app.json", "tsconfig.json"]) if (existsSync(join(d, n))) return join(d, n);
  }
  return "";
};
