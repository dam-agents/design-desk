// node --test toolkit/tests/anchors.test.mjs — the names people's notes hang on (data-anchor,
// docs/requests.md → Names notes hang on): one per part and view, checked by the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorProblems } from "../bin/build.mjs";

test("the build refuses a name twice in one view, and a name that is not one; the same name in two views is fine", () => {
  const view = (n, body) => `<div data-view="${n}" data-view-name="V${n}">${body}</div>`;
  assert.deepEqual(anchorProblems(view(1, '<ul data-anchor="spender-list"><li>a</li></ul>') + view(2, '<ul data-anchor="spender-list"></ul>')), []);
  assert.deepEqual(anchorProblems(view(1, '<ul data-anchor="spender-list"><li>a<li>b</ul><p data-anchor="spender-list">x</p>')), ['data-anchor="spender-list" twice in view 1']);
  // A view closed by its own tag: what follows is outside it, a page-wide part.
  assert.deepEqual(anchorProblems(view(1, '<div><br><img src=x><b data-anchor="total">1</b></div>') + '<footer data-anchor="total">x</footer>'), []);
  assert.deepEqual(anchorProblems('<p data-anchor="Spender List">x</p>'), ['data-anchor="Spender List" in the page is not a name: lowercase letters, digits and dashes, at most 40']);
  // Scripts, styles, comments and a control's templates are not the page's parts.
  assert.deepEqual(anchorProblems(view(1, '<b data-anchor="x">1</b><template data-desk-option="y"><b data-anchor="x">2</b></template><!-- <b data-anchor="x"> --><script>const s = \'<b data-anchor="x">\';</script>')), []);
});
