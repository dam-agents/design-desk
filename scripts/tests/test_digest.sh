#!/usr/bin/env bash
# The digest pre-flight: silent when disabled, without a store, in a quiet week or once the
# week's page exists; the page's name and its items share one span, the seven whole UTC days
# up to yesterday.
. "$(dirname "$0")/lib.sh"
# A fixed clock: `date -u +<format>` reads $FAKE_NOW; every other call is the real date.
mkdir -p "$SANDBOX/clock"
cat > "$SANDBOX/clock/date" <<'SH'
#!/usr/bin/env bash
case "${1:-} ${2:-}" in
  "-u +"*) shift; /bin/date -u -d "@$FAKE_NOW" "$@" 2>/dev/null || /bin/date -u -r "$FAKE_NOW" "$@" ;;
  *) exec /bin/date "$@" ;;
esac
SH
chmod +x "$SANDBOX/clock/date"
export PATH="$SANDBOX/clock:$PATH"

export FAKE_NOW=1793865600 # Thu 2026-11-05 08:00 UTC, ISO week 2026-W45
printf -- '- digest: disabled\n' > "$WORK_DIR/CONFIG.md"
assert "off when disabled" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" digest)"
: > "$WORK_DIR/CONFIG.md"
assert "silent without a store" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" digest)"

mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/db.json" <<'JSON'
{"cards":{
 "C-1":{"id":"C-1","kind":"change","title":"Before the week","created":"2026-10-28T23:00:00Z","source":{"merged_at":"2026-10-28T23:00:00Z"}},
 "C-2":{"id":"C-2","kind":"change","title":"First day","created":"2026-10-29T00:00:00Z","source":{"merged_at":"2026-10-29T00:00:00Z"}},
 "C-3":{"id":"C-3","kind":"change","title":"Last day","created":"2026-11-04T23:59:00Z","source":{"merged_at":"2026-11-04T23:59:00Z"}},
 "C-4":{"id":"C-4","kind":"change","title":"This morning","created":"2026-11-05T07:00:00Z","source":{"merged_at":"2026-11-05T07:00:00Z"}},
 "C-5":{"id":"C-5","kind":"change","title":"New year","created":"2026-01-01T10:00:00Z","source":{"merged_at":"2026-01-01T10:00:00Z"}}},
 "threads":[],"inbox":{}}
JSON
out="$(bash "$ROOT/scripts/preflight.sh" digest)"
assert "work is due" '.nothing_to_do == false and .mode == "digest" and .period == "2026-W45"' "$out"
assert "read_set names the digest doc and the explain skill" '.read_set == ["docs/digest.md", ".agents/skills/explain/SKILL.md"]' "$out"
assert "named by its days, the year once" '.dates == "29 Oct – 4 Nov 2026"' "$out"
assert "its items are those days, this morning's wait for next week" '[.changes[].id] == ["C-2", "C-3"]' "$out"
# A developer's question for the designer on Designs is not feedback on the product.
jq '.threads = {"T-1":{"id":"T-1","card":"C-3","kind":"comment","created":"2026-11-03T10:00:00Z","messages":[{"by":{"email":"a@example.com"},"text":"Too small."}]},
  "T-2":{"id":"T-2","card":"C-3","kind":"comment","dev":true,"created":"2026-11-03T11:00:00Z","messages":[{"by":{"email":"b@example.com"},"text":"Is it sticky?"}]}}' "$DESK_DIR/db.json" > "$STUB_DIR/db" && mv "$STUB_DIR/db" "$DESK_DIR/db.json"
assert "feedback leaves out questions for the designer" '[.feedback[].text] == ["Too small."]' "$(bash "$ROOT/scripts/preflight.sh" digest)"

export FAKE_NOW=1767427200 # Sat 2026-01-03 08:00 UTC
out2="$(bash "$ROOT/scripts/preflight.sh" digest)"
assert "a week across the new year names both years" '.dates == "27 Dec 2025 – 2 Jan 2026" and [.changes[].id] == ["C-5"]' "$out2"
export FAKE_NOW=1797840000 # Mon 2026-12-21 08:00 UTC
assert "a week with nothing in it is quiet" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" digest)"

export FAKE_NOW=1793865600
jq '.cards["C-9"] = {"id":"C-9","kind":"digest","period":"2026-W45"}' "$DESK_DIR/db.json" > "$STUB_DIR/db" && mv "$STUB_DIR/db" "$DESK_DIR/db.json"
assert "silent once the week's page exists" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" digest)"
finish
