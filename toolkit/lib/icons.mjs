// <ui-icon name="ChevronLeft" size="16" class="…"/> — an icon from the package the
// style uses (the repo's own, or Carbon), by the same name the source code imports.
// <ui-pictogram name="Robot"/> — a Carbon pictogram (Carbon styles and Carbon repos).
import { join } from "node:path";
import { fail, attrs, tagRe, req, slugOf } from "./core.mjs";
import { toolchain } from "./toolchain.mjs";

const ADAPTERS = {
  // name → how to find the component and size it
  "@carbon/icons-react": { find: (lib, n) => lib[n], size: (s) => ({ size: Number(s) }) },
  "lucide-react": { find: (lib, n) => lib[n] || lib[`${n}Icon`], size: (s) => ({ size: Number(s) }) },
  "@heroicons/react": { sub: "24/outline", find: (lib, n) => lib[n] || lib[`${n}Icon`], size: (s) => ({ width: Number(s), height: Number(s) }) },
  "@phosphor-icons/react": { find: (lib, n) => lib[n], size: (s) => ({ size: Number(s) }) },
  "@tabler/icons-react": { find: (lib, n) => lib[n] || lib[`Icon${n}`], size: (s) => ({ size: Number(s) }) },
  "@radix-ui/react-icons": { find: (lib, n) => lib[n] || lib[`${n}Icon`], size: (s) => ({ width: Number(s), height: Number(s) }) },
  "@mui/icons-material": { find: (lib, n) => lib[n], size: (s) => ({ style: { fontSize: Number(s) } }) },
  "react-feather": { find: (lib, n) => lib[n], size: (s) => ({ size: Number(s) }) },
};

export function iconLib(style) {
  const pkg = style.kind === "repo" ? style.profile.icon_package || "@carbon/icons-react" : "@carbon/icons-react";
  if (!ADAPTERS[pkg]) fail(`<ui-icon>: ${pkg} is not supported yet — inline the repo's SVG instead, and say so`);
  if (pkg === "@carbon/icons-react" && style.kind !== "repo") return { pkg, lib: req("@carbon/icons-react"), h: req("react").createElement, render: req("react-dom/server").renderToStaticMarkup };
  const v = style.profile?.versions?.[pkg] || "latest";
  const reactV = style.profile?.versions?.react || "18.3.1";
  const tc = toolchain(`icons-${slugOf(style.repo || "carbon")}`, { [pkg]: v, react: reactV, "react-dom": style.profile?.versions?.["react-dom"] || reactV });
  const a = ADAPTERS[pkg];
  return { pkg, lib: tc.req(a.sub ? `${pkg}/${a.sub}` : pkg), h: tc.req("react").createElement, render: tc.req("react-dom/server").renderToStaticMarkup };
}

export function renderIcons(html, style) {
  if (!/<ui-(icon|pictogram)\b/.test(html)) return html;
  const { pkg, lib, h, render } = iconLib(style);
  const a = ADAPTERS[pkg];
  html = html.replace(tagRe("ui-icon"), (_, s) => {
    const { name, size, class: className, ...rest } = attrs(s);
    const C = a.find(lib, name);
    if (!C) fail(`no icon "${name}" in ${pkg} — use the exact name the source imports (\`design icons ${pkg} ${name}\` checks)`);
    return render(h(C, { ...(size ? a.size(size) : {}), ...(className ? { className } : {}), "aria-hidden": "true", ...rest }));
  });
  if (/<ui-pictogram\b/.test(html)) {
    const picto = req("@carbon/pictograms-react");
    html = html.replace(tagRe("ui-pictogram"), (_, s) => {
      const { name, class: className, ...rest } = attrs(s);
      const C = picto[name];
      if (!C) fail(`no pictogram "${name}" in @carbon/pictograms-react`);
      return req("react-dom/server").renderToStaticMarkup(req("react").createElement(C, { ...(className ? { className } : {}), ...rest }));
    });
  }
  return html;
}

export async function main(_cmd, [pkg, ...names]) {
  if (!pkg || !names.length) { console.error("usage: design icons <package> <Name>..."); process.exit(2); }
  const style = pkg === "@carbon/icons-react" ? { kind: "carbon" } : { kind: "repo", repo: "probe", profile: { icon_package: pkg, versions: {} } };
  const { lib } = iconLib(style);
  const a = ADAPTERS[pkg];
  let bad = 0;
  for (const n of names) { const ok = !!a.find(lib, n); if (!ok) bad++; console.log(`${ok ? "ok  " : "MISS"} ${n}`); }
  if (bad) {
    const all = Object.keys(lib);
    for (const n of names) if (!a.find(lib, n)) console.log(`  near ${n}: ${all.filter((k) => k.toLowerCase().includes(n.toLowerCase().slice(0, 5))).slice(0, 8).join(", ")}`);
  }
  process.exit(bad ? 1 : 0);
}
