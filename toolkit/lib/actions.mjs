// The actions Design Desk can take, each done by one skill. A product's design profile
// (`skills`) or work/CONFIG.md (`## Skills`) names another installed skill for an action;
// the bundled one is the fallback. docs/actions.md is the contract.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HOME, TOOLKIT } from "./core.mjs";

export const ACTIONS = {
  "explain-change": { skill: "explain", doc: "docs/watch.md", does: "a card for a shipped or open UI change: screens, what, why, what cannot change" },
  answer: { skill: "explain", doc: "docs/desk.md", does: "answer a question about how the product works or why" },
  show: { skill: "show-me", does: "answer \"show me how it looks\" with a picture of the product in that state" },
  map: { doc: "docs/map.md", does: "the product map: every main screen, how to get there, why it is like it is" },
  digest: { doc: "docs/digest.md", does: "the weekly digest of the product's UX and the themes in people's feedback" },
  research: { doc: "docs/requests.md", does: "issues, pull requests, history and earlier decisions behind a request" },
  triage: { doc: "docs/boundary.md", does: "what can be done as a design change, what needs a developer or a decision" },
  impact: { skill: "impact", does: "where else the same thing shows up and what a change touches, from earlier decisions" },
  options: { skill: "variants", doc: "docs/requests.md", does: "two or three design options in the product's look, on sample data" },
  revise: { skill: "variants", fallback: "options", doc: "docs/requests.md", does: "apply people's notes on elements to an option, as a new version" },
  prototype: { doc: "docs/prototype.md", does: "a live prototype: the product with the design change, in an Environment" },
  spec: { doc: "docs/handoff.md", does: "the developer spec of an approved design" },
  deliver: { skill: "handoff-github", doc: "docs/handoff.md", does: "send the spec on: the origin issue, a coding agent, an issue or a draft pull request" },
  "bug-intake": { skill: "intake-slack", does: "put a UI bug reported on a channel on the Desk's queue" },
  "figma-import": { skill: "figma", does: "bring a Figma frame in as a design option built from the product's parts" },
  "figma-export": { skill: "figma", does: "send a design option to Figma as editable layers" },
  "share-options": { skill: "slack-polls", does: "post a request's options to Slack for votes and comments" },
  "poll-sync": { skill: "slack-polls", does: "bring Slack votes and replies to the Desk; close a vote with its result" },
  catalog: { doc: "docs/catalog.md", does: "draw a real UI element in every state" },
  brief: { doc: "docs/desk.md", does: "the brief of an item on the next call" },
  deck: { skill: "slides", does: "a slide deck and its PDF" },
  walkthrough: { skill: "walkthrough", does: "a step-by-step tour of a flow" },
  video: { skill: "demo-video", does: "a demo or launch video" },
  brand: { skill: "brand", does: "save a brand from a logo, colours and fonts" },
  copy: { skill: "copy", does: "words: UI copy, announcements, the last pass on a deliverable" },
};

// Where the harness reads skills: the platform's skill path and the definition's own.
export function skillPaths() {
  const env = (process.env.DESIGN_DESK_SKILL_PATHS || "").split(":").filter(Boolean);
  return env.length ? env : [...new Set([join(HOME, ".claude/skills"), join(HOME, ".agents/skills"), join(TOOLKIT, "..", ".agents/skills")])];
}

// A skill by its directory, else by its front matter `name:`, first path first.
export function findSkill(name, paths = skillPaths()) {
  for (const p of paths) {
    const direct = join(p, name, "SKILL.md");
    if (existsSync(direct)) return direct;
  }
  for (const p of paths) {
    let dirs = [];
    try { dirs = readdirSync(p); } catch { continue; }
    for (const d of dirs) {
      const f = join(p, d, "SKILL.md");
      try { if (new RegExp(`^name:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(readFileSync(f, "utf8").split(/\n---/)[0])) return f; } catch {}
    }
  }
  return null;
}

// The skill for an action: the operator's choice, then the product's, then the bundled one.
// A chosen skill that is not installed falls back, and says so.
export function resolve(action, { config = {}, profile = {} } = {}) {
  const a = ACTIONS[action];
  if (!a) return null;
  const base = a.fallback ? resolve(a.fallback, { config, profile }) : null;
  const choices = [
    ["config", config[action]],
    ["profile", typeof profile[action] === "string" ? profile[action] : profile[action]?.skill],
    ...(base && base.source !== "default" ? [[base.source, base.skill]] : []),
    ["default", a.skill],
  ].filter(([, s]) => s);
  const notes = [];
  for (const [source, skill] of choices) {
    const path = findSkill(skill);
    if (path) return { action, skill, source, path, doc: a.doc || null, does: a.does, notes };
    notes.push(`${skill} (${source === "default" ? "bundled" : source}) is not installed${source === "profile" && profile[action]?.source ? `; install it from ${profile[action].source}` : ""}`);
  }
  // Core actions without a bundled skill are procedures in the definition's docs.
  return { action, skill: null, source: "default", path: null, doc: a.doc || null, does: a.does, notes };
}
