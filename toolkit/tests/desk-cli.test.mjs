// node --test toolkit/tests/desk-cli.test.mjs — the paths `design desk` commands call on the Desk server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionCheckPath } from "../bin/desk.mjs";

test("decision-check reads the card's check route with its concepts and words encoded", () => {
  assert.equal(decisionCheckPath("C-3", { concept: "send button,limits", q: "a&b" }), "/agent/cards/C-3/decision-check?concept=send%20button%2Climits&q=a%26b");
  assert.equal(decisionCheckPath("C-3"), "/agent/cards/C-3/decision-check?concept=&q=", "no concepts and no words: the card's own concepts");
});
