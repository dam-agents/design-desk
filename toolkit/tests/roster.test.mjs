// node --test toolkit/tests/roster.test.mjs — the one row a lead's ask adds to ## Desk people.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withRosterRow } from "../lib/core.mjs";

const CONFIG = "- display_name: Desk\n\n## Desk people\n\n| email | role |\n| --- | --- |\n| lee@example.com | lead |\n\n## Skills\n\n| action | skill |\n";

test("the row goes after the table's last row, and nothing else changes", () => {
  const out = withRosterRow(CONFIG, "alex@example.com", "pm");
  assert.equal(out, CONFIG.replace("| lee@example.com | lead |\n", "| lee@example.com | lead |\n| alex@example.com | pm |\n"));
});

test("no table yet: one at the end", () => {
  assert.match(withRosterRow("- display_name: Desk\n", "alex@example.com", "pm"), /\n## Desk people\n\n\| email \| role \|\n\| --- \| --- \|\n\| alex@example\.com \| pm \|\n$/);
});

test("an email on the list, or a cell that breaks the table, is refused", () => {
  assert.throws(() => withRosterRow(CONFIG, "LEE@example.com", "pm"), /already on the list/);
  assert.throws(() => withRosterRow(CONFIG, "a|b@example.com", "pm"), /cannot go in the table/);
  assert.throws(() => withRosterRow(CONFIG, "a@example.com", "pm\n| x | lead"), /cannot go in the table/);
});
