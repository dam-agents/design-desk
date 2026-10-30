#!/usr/bin/env bash
# install-toolkit.sh — put the Design Desk toolchain in place. Idempotent; the kit's
# `install` step runs it before the first session, ONBOARDING runs it again, and
# the agent re-runs it whenever `design doctor` reports a FAIL.
#
#   1. npm packages of ~/toolkit (Tailwind, React, Playwright, ffmpeg, Carbon,
#      fonts), from its package.json: the home disk, so they last across restarts.
#   2. A headless Chromium. The image's Playwright Chromium is used when present;
#      otherwise a self-contained one from @sparticuz/chromium is unpacked into
#      ~/.local/share/design-desk/chromium (its own libs and fonts, no root needed).
#   3. ~/bin/design, the one command every skill calls.
#
# Prints one line per step and exits non-zero only when a step that the skills
# cannot work without failed.
set -u
HOME_DIR="${HOME:-/home/agent}"
TK="$HOME_DIR/toolkit"
DATA="${DESIGN_DESK_DATA:-$HOME_DIR/.local/share/design-desk}"
fail=0

if [ ! -f "$TK/package.json" ]; then
  echo "FAIL toolkit — $TK/package.json missing: the definition checkout is incomplete"; exit 1
fi

# 1. Packages. ffmpeg-static downloads its binary in an install script; allow it.
if (cd "$TK" && npm ci --no-audit --no-fund --loglevel=error 2>/dev/null || npm install --no-audit --no-fund --loglevel=error) >/dev/null; then
  ff="$TK/node_modules/ffmpeg-static/ffmpeg"
  if [ ! -x "$ff" ]; then (cd "$TK/node_modules/ffmpeg-static" && node install.js >/dev/null 2>&1); fi
  [ -x "$ff" ] && echo "ok   packages — $TK/node_modules" || { echo "FAIL ffmpeg — the ffmpeg-static binary did not download (github.com release assets must be reachable)"; fail=1; }
else
  echo "FAIL packages — npm install failed in $TK (is registry.npmjs.org reachable?)"; fail=1
fi

# 2. Browser.
have_browser=""
for d in /opt/ms-playwright/chromium-*/chrome-linux64/chrome; do [ -x "$d" ] && have_browser="$d"; done
[ -z "$have_browser" ] && [ -x "$DATA/chromium/chromium" ] && have_browser="$DATA/chromium/chromium"
if [ -z "$have_browser" ]; then
  tmp="$(mktemp -d)"
  if (cd "$tmp" && npm init -y >/dev/null && npm i --no-audit --no-fund --loglevel=error @sparticuz/chromium@153 >/dev/null); then
    mkdir -p "$DATA/chromium/fonts"
    node -e '
      const z = require("zlib"), f = require("fs"), b = process.argv[1] + "/node_modules/@sparticuz/chromium/bin/", o = process.argv[2];
      for (const [i, out] of [["chromium.br", o + "/chromium"], ["al2023.tar.br", o + "/libs.tar"], ["fonts.tar.br", o + "/fonts.tar"]])
        if (f.existsSync(b + i)) f.writeFileSync(out, z.brotliDecompressSync(f.readFileSync(b + i)));
    ' "$tmp" "$DATA/chromium"
    (cd "$DATA/chromium" && tar -xf libs.tar 2>/dev/null; rm -f libs.tar)
    (cd "$DATA/chromium/fonts" && tar -xf ../fonts.tar 2>/dev/null; rm -f ../fonts.tar)
    chmod +x "$DATA/chromium/chromium" 2>/dev/null
    [ -x "$DATA/chromium/chromium" ] && have_browser="$DATA/chromium/chromium"
  fi
  rm -rf "$tmp"
fi
if [ -n "$have_browser" ]; then echo "ok   browser — $have_browser"
else echo "FAIL browser — no Chromium in the image and the fallback did not unpack; set CHROMIUM=/path/to/chrome"; fail=1; fi

# 3. The command.
mkdir -p "$HOME_DIR/bin"
cat > "$HOME_DIR/bin/design" <<WRAP
#!/usr/bin/env bash
exec node "$TK/bin/design.mjs" "\$@"
WRAP
chmod +x "$HOME_DIR/bin/design"
echo "ok   command — $HOME_DIR/bin/design (run \`design\` for usage)"
case ":$PATH:" in (*":$HOME_DIR/bin:"*) ;; (*) echo "note PATH — $HOME_DIR/bin is not on PATH; call it as ~/bin/design";; esac
exit "$fail"
