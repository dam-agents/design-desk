// The handoff bundle (docs/handoff.md → The bundle): from an approved request, the same files
// and design.json for any product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleOf } from "../bin/desk.mjs";

const card = {
  id: "C-7", title: "Calmer header", request: { type: "idea", problem: "The header is too loud." },
  approved: { by: { email: "alice@example.com" }, at: "2026-11-06T10:00:00Z", variant: "v2", version: 3, implement: true },
  triage: { verdict: "needs-developer", can: ["Grey header"], cannot: ["Sort by spend: no such order in the data."] },
  variants: [{ id: "v1", name: "Bold", asset: "A-1" }, { id: "v2", name: "Quiet", asset: "A-2", version: 3,
    elements: [{ id: "e1", name: "Header", change: "changed", how: "Grey, smaller.", selector: "header" }],
    states: [{ id: "s1", name: "Empty list", part: "Header", element: "e1", how: "No agents yet.", asset: "A-3", shot: "A-4", stories: ["u1"] }],
    stories: [{ story: "u1", met: "yes" }], reasons: [{ decision: "D-2", how: "Greys stay quiet." }] }],
  issue_brief: { stories: [{ id: "u1", text: "As a lead I see the list calmly" }] },
  spec: { asset: "A-9", acceptance: [{ given: "the agents list", when: "it opens", then: "the header is grey" }] },
  prototype: { branch: "design-desk/c7-calm", patch: "A-8" },
};

test("the bundle carries the approved option, its states, the boundary and the acceptance criteria", () => {
  const { design, files } = bundleOf(card);
  assert.equal(design.format, "design-desk/handoff@1");
  assert.deepEqual(design.approved.option, { id: "v2", name: "Quiet", version: 3 }, "the option a person approved, not the first");
  assert.equal(design.approved.straight_to_implementation, true);
  assert.deepEqual(design.boundary.needs_developer, ["Sort by spend: no such order in the data."]);
  assert.deepEqual(design.elements[0].states, ["s1"], "an element lists its states");
  assert.equal(design.states[0].shot, "shots/s1-empty-list.png");
  assert.deepEqual(design.stories, [{ id: "u1", text: "As a lead I see the list calmly", met: "yes" }]);
  assert.equal(design.acceptance[0].then, "the header is grey");
  assert.deepEqual(design.decisions, [{ decision: "D-2", how: "Greys stay quiet." }]);
  assert.deepEqual(files.map((f) => [f.path, f.asset]), [["spec.md", "A-9"], ["mockup.html", "A-2"], ["states/s1-empty-list.html", "A-3"], ["shots/s1-empty-list.png", "A-4"], ["prototype.patch", "A-8"]]);
});

test("a live prototype's option and version are what the bundle carries", () => {
  const live = { ...card, live_pick: { variant: "v1", version: 2, asset: "A-11" }, approved: { ...card.approved, variant: "v1", version: 2 } };
  const { design, files } = bundleOf(live);
  assert.deepEqual(design.approved.option, { id: "v1", name: "Bold", version: 2 });
  assert.equal(files.find((f) => f.path === "mockup.html").asset, "A-11", "the page the prototype showed");
});
