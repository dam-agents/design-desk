// node --test toolkit/tests/github.test.mjs — design desk github-sync: what it reads on
// GitHub, what it keeps on the Desk, and a key it cannot read (docs/desk.md → GitHub on the Desk).
import { test } from "node:test";
import assert from "node:assert/strict";
import { githubSync } from "../bin/desk.mjs";

// A stand-in gh: each REST path answers one page, as `gh api --paginate --slurp` does.
const GH = {
  "repos/acme/widgets/issues/3": [{ title: "One account", state: "open", html_url: "https://github.com/acme/widgets/issues/3", user: { login: "pat" }, labels: [{ name: "design" }], body: "b", updated_at: "2026-11-02T10:00:00Z" }],
  "repos/acme/widgets/issues/3/timeline": [[{ event: "labeled" }, { event: "cross-referenced", source: { issue: { title: "Build the red", html_url: "https://github.com/acme/widgets/pull/8", user: { login: "bot" }, state: "open", draft: false, pull_request: { merged_at: null } } } }]],
  "repos/acme/widgets/issues/3/comments": [[{ user: { login: "lee" }, created_at: "2026-11-02T10:00:00Z", html_url: "https://github.com/acme/widgets/issues/3#c1", body: "Make it red?" }]],
  "repos/acme/widgets/issues/7": [{ title: "Limits", state: "closed", pull_request: { merged_at: "2026-11-01T10:00:00Z" }, html_url: "https://github.com/acme/widgets/pull/7", user: { login: "bob" }, labels: [], body: "", updated_at: "2026-11-01T10:00:00Z" }],
  "repos/acme/widgets/issues/7/comments": [[]],
  "repos/acme/widgets/pulls/7/reviews": [[{ user: { login: "dana" }, submitted_at: "2026-11-01T09:00:00Z", html_url: "https://github.com/acme/widgets/pull/7#r1", state: "APPROVED", body: "Fine." }, { user: { login: "x" }, state: "COMMENTED", body: "" }]],
};
const gh = (args) => { const path = args[args.length - 1]; return path in GH ? { status: 0, stdout: JSON.stringify(GH[path]) } : { status: 1, stderr: "HTTP 404: Not Found\n" }; };

test("github-sync reads each ref with its comments and reviews, posts them, merges fresh, and names a key it cannot read", async () => {
  const posted = [], failed = [];
  const call = async (method, path, body) => {
    if (method === "GET") return { refs: ["acme/widgets#3", "acme/widgets#7", "acme/widgets#9"] };
    if (path === "/agent/github/failed") { failed.push(body); return { gave_up: body.keys }; }
    posted.push(body);
    return { fresh: [{ key: "acme/widgets#3", cards: ["C-1"], comments: body.records[0].comments }] };
  };
  const out = await githubSync(null, { call, gh });
  assert.equal(posted.length, 1, "one batch for three refs");
  const [issue, pr] = posted[0].records;
  assert.deepEqual([issue.kind, issue.state, issue.labels, issue.comments.map((c) => c.body)], ["issue", "open", ["design"], ["Make it red?"]]);
  assert.deepEqual(issue.linked, [{ title: "Build the red", url: "https://github.com/acme/widgets/pull/8", state: "open", author: "bot" }], "an issue knows the pull requests that build it");
  assert.deepEqual([pr.kind, pr.state, pr.comments.map((c) => c.body)], ["pr", "merged", ["[review: APPROVED] Fine."]], "a pull request's reviews with a body are its comments");
  assert.deepEqual([out.synced, out.failed.map((x) => x.key), out.fresh.map((x) => x.key)], [2, ["acme/widgets#9"], ["acme/widgets#3"]]);
  assert.match(out.failed[0].error, /404/);
  assert.deepEqual(failed, [{ keys: ["acme/widgets#9"] }], "the key it cannot read is counted on the Desk");
  assert.deepEqual(out.gave_up, ["acme/widgets#9"], "and named when the Desk gives up on it");
});
