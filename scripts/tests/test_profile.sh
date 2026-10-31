#!/usr/bin/env bash
# Repo profile detection on fixture repositories: Tailwind v4 + shadcn, Tailwind v3,
# CSS-in-JS, plain CSS, and a repo with no UI. No network: detect() reads files only.
. "$(dirname "$0")/lib.sh"
need_node
T="$SANDBOX/repos"
mk() { mkdir -p "$(dirname "$T/$1")"; cat > "$T/$1"; }

# 1. Tailwind v4 monorepo with shadcn + lucide + pnpm lockfile
mk v4/packages/web/package.json <<'J'
{"name":"web","dependencies":{"react":"^19.0.0","tailwindcss":"^4.1.0","tailwind-merge":"^3.0.0","lucide-react":"^0.400.0","vite":"^6"}}
J
mk v4/packages/web/components.json <<'J'
{"tailwind":{"css":"src/index.css"}}
J
mk v4/packages/web/src/index.css <<'C'
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
C
mk v4/packages/web/src/App.tsx <<'X'
import { Home } from "lucide-react";
export default function App() { return <Home /> }
X
mk v4/packages/web/index.html <<'H'
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
H
mk v4/pnpm-lock.yaml <<'Y'
lockfileVersion: '9.0'
importers:
  packages/web:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.1.0
      tailwindcss:
        specifier: ^4.1.0
        version: 4.1.7
      lucide-react:
        specifier: ^0.400.0
        version: 0.400.0(react@19.1.0)
      shared:
        specifier: workspace:*
        version: link:../shared
Y
# 2. Tailwind v3 with npm lockfile + heroicons
mk v3/package.json <<'J'
{"name":"site","dependencies":{"react":"18.2.0","@heroicons/react":"2.1.0"},"devDependencies":{"tailwindcss":"^3.4.0"}}
J
mk v3/tailwind.config.js <<'J'
module.exports = { content: ["./src/**/*.tsx"], plugins: [require("@tailwindcss/forms")] };
J
mk v3/src/styles/globals.css <<'C'
@tailwind base;
@tailwind components;
@tailwind utilities;
C
mk v3/src/a.tsx <<'X'
import { HomeIcon } from "@heroicons/react/24/outline";
X
mk v3/package-lock.json <<'J'
{"packages":{"":{},"node_modules/tailwindcss":{"version":"3.4.17"},"node_modules/react":{"version":"18.2.0"}}}
J
# 3. CSS-in-JS
mk mui/package.json <<'J'
{"name":"m","dependencies":{"react":"18.3.1","@mui/material":"5.15.0","@mui/icons-material":"5.15.0"}}
J
mk mui/src/a.tsx <<'X'
import Home from "@mui/icons-material/Home";
X
# 4. Plain CSS modules
mk css/package.json <<'J'
{"name":"c","dependencies":{"react":"18.3.1"}}
J
mk css/src/App.module.css <<'C'
.a { color: red }
C
mk css/src/index.css <<'C'
body { margin: 0 }
C
# 4b. Next.js app router: next/font google + local, single-package pnpm v6 lockfile
mk next/package.json <<'J'
{"name":"n","dependencies":{"react":"^18.2.0","next":"13.4.0","lucide-react":"0.92.0"},"devDependencies":{"tailwindcss":"^3.3.1"}}
J
mk next/tailwind.config.js <<'J'
module.exports = { content: ["./app/**/*.tsx"] };
J
mk next/styles/globals.css <<'C'
@tailwind base;
C
mk next/app/layout.tsx <<'X'
import { Inter as FontSans } from "next/font/google"
import localFont from "next/font/local"
const fontSans = FontSans({ subsets: ["latin"], variable: "--font-sans" })
const fontHeading = localFont({ src: "../assets/fonts/CalSans-SemiBold.woff2", variable: "--font-heading" })
X
mk next/pnpm-lock.yaml <<'Y'
lockfileVersion: '6.0'
dependencies:
  react:
    specifier: ^18.2.0
    version: 18.2.0
devDependencies:
  tailwindcss:
    specifier: ^3.3.1
    version: 3.3.1(postcss@8.4.23)
Y
# 5. No UI
mk lib/package.json <<'J'
{"name":"lib","dependencies":{"lodash":"4"}}
J

run() { WORK_DIR="$T/w" node --input-type=module -e "
  import('$ROOT/toolkit/lib/profile.mjs').then(m => { const r = m.detect('acme/x', '$T/$1', 'abc1234'); process.stdout.write(JSON.stringify(r.profile)); })" 2>/dev/null; }
fail=0
check() { # name, json, jq-expr
  if ! printf '%s' "$2" | jq -e "$3" >/dev/null 2>&1; then echo "  $1: expected $3 in $2"; fail=1; fi; }
p="$(run v4)";  check v4 "$p" '.styling=="tailwind" and .tailwind_major==4 and .ui_dir=="packages/web" and .css_entry=="packages/web/src/index.css" and .icon_package=="lucide-react" and .class_merge=="tailwind-merge" and .versions.tailwindcss=="4.1.7" and .versions["lucide-react"]=="0.400.0" and (.fonts|index("Inter")) != null and .dark_mode=="class"'
p="$(run v3)";  check v3 "$p" '.styling=="tailwind" and .tailwind_major==3 and .tailwind_config=="tailwind.config.js" and .css_entry=="src/styles/globals.css" and .icon_package=="@heroicons/react" and .versions.tailwindcss=="3.4.17"'
p="$(run mui)"; check mui "$p" '.styling=="css-in-js" and .icon_package=="@mui/icons-material"'
p="$(run css)"; check css "$p" '.styling=="css-modules" and .css_entry=="src/index.css"'
p="$(run lib)"; check lib "$p" '.kind=="none"'
p="$(run next)"; check next "$p" '.tailwind_major==3 and .versions.tailwindcss=="3.3.1" and .versions.react=="18.2.0" and (.fonts|index("Inter")) != null and .fonts_local==["assets/fonts/CalSans-SemiBold.woff2"] and .font_vars["--font-sans"]=="Inter" and .font_vars["--font-heading"]=="CalSans"'
# workspace versions never leak into npm installs
v="$(node --input-type=module -e "import('$ROOT/toolkit/lib/profile.mjs').then(m => process.stdout.write(JSON.stringify(m.lockedVersions('$T/v4', '$T/v4/packages/web', ['shared','react']))))")"
check workspace "$v" '.react=="19.1.0" and (has("shared")|not)'
# bare imports a CSS file or config pulls in
b="$(node --input-type=module -e "import('$ROOT/toolkit/lib/toolchain.mjs').then(m => process.stdout.write(JSON.stringify(m.bareImports('@import \"tailwindcss\";\n@import \"tw-animate-css\";\n@import \"./local.css\";\n@plugin \"@tailwindcss/typography\";\n@import \"highlight.js/styles/github.css\";'))))")"
check imports "$b" '. == ["tw-animate-css","@tailwindcss/typography","highlight.js"]'
exit $fail
