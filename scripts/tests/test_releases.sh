#!/usr/bin/env bash
# The watch pre-flight: releases published since watch_since that the Desk does not keep yet
# become releases_due, each with the pull requests since the release before it.
. "$(dirname "$0")/lib.sh"
cat > "$WORK_DIR/CONFIG.md" <<CFG
- repos: acme/widgets
- watch_since: 2026-10-01T00:00:00Z
CFG
echo '{"incomplete_results":false,"items":[]}' > "$STUB_DIR/search.json"
cat > "$STUB_DIR/releases.json" <<'JSON'
[{"tag_name":"v1.2.0","name":"v1.2.0","html_url":"https://github.com/acme/widgets/releases/tag/v1.2.0","published_at":"2026-11-10T08:00:00Z","prerelease":false,"draft":false},
 {"tag_name":"v1.2.0-rc.1","name":"","html_url":"https://github.com/acme/widgets/releases/tag/v1.2.0-rc.1","published_at":"2026-11-07T08:00:00Z","prerelease":true,"draft":false},
 {"tag_name":"v1.3.0-draft","name":"Draft","html_url":"https://github.com/acme/widgets/releases/tag/v1.3.0-draft","published_at":null,"prerelease":false,"draft":true},
 {"tag_name":"v1.1.0","name":"v1.1.0","html_url":"https://github.com/acme/widgets/releases/tag/v1.1.0","published_at":"2026-09-20T08:00:00Z","prerelease":false,"draft":false}]
JSON
printf 'Fix the dialog copy (#21)\nMerge pull request #22 from acme/feature\nchore: bump version\n' > "$STUB_DIR/compare-v1.1.0...v1.2.0-rc.1.txt"
printf 'Card fields line up (#23)\nFix the dialog copy (#21)\n' > "$STUB_DIR/compare-v1.2.0-rc.1...v1.2.0.txt"

out="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "work is due for the releases alone" '.nothing_to_do == false and (.changes_due | length) == 0' "$out"
assert "the title says so" '.title == "Keep the new releases"' "$out"
assert "two releases since watch_since, oldest first; no draft, none before" '[.releases_due[].tag] == ["v1.2.0-rc.1", "v1.2.0"]' "$out"
assert "pull requests from squash and merge messages, once each" '.releases_due[0].prs == [21, 22]' "$out"
assert "each against the release before it" '.releases_due[1].previous == "v1.2.0-rc.1" and .releases_due[1].prs == [21, 23]' "$out"
assert "a release with no name: its tag" '.releases_due[0].name == "v1.2.0-rc.1" and .releases_due[0].prerelease == true' "$out"

# Releases the Desk keeps already are not due again.
mkdir -p "$DESK_DIR"
echo '{"keys":["acme/widgets#v1.2.0-rc.1","acme/widgets#v1.2.0"]}' > "$DESK_DIR/releases.json"
out2="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "nothing left to do" '.nothing_to_do == true' "$out2"

# A compare that fails keeps no record: the release waits for the next pass, never kept with no pull requests.
rm -f "$DESK_DIR/releases.json" "$STUB_DIR/compare-v1.2.0-rc.1...v1.2.0.txt"
out4="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "a release whose compare failed is not due" '[.releases_due[].tag] == ["v1.2.0-rc.1"]' "$out4"
assert "and the pass says so" '[.logs[] | select(test("v1.2.0: could not compare"))] | length == 1' "$out4"

# A releases.json the Desk wrote that cannot be read is not "none kept": no release is due.
echo 'not json' > "$DESK_DIR/releases.json"
out5="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "nothing due while the Desk's list cannot be read" '.nothing_to_do == true' "$out5"
assert "and the pass says why" '[.logs[] | select(test("releases.json cannot be read"))] | length == 1' "$out5"

# A repository whose releases cannot be read is logged, never a failed pass.
rm -f "$DESK_DIR/releases.json"; echo 'not json' > "$STUB_DIR/releases.json"
out3="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "still JSON" '.mode? // .nothing_to_do | . != null' "$out3"
finish
