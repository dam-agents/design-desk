// The actions Design Desk can take, each done by one skill. A product's design profile
// (`skills`) or work/CONFIG.md (`## Skills`) names another installed skill for an action;
// the bundled one is the fallback. docs/actions.md is the contract.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve as absolute } from "node:path";
import { HOME, TOOLKIT } from "./core.mjs";

export const ACTIONS = {
  "explain-change": { skill: "explain", doc: "docs/watch.md", does: "a card for a shipped or open UI change: screens, what, why, what cannot change" },
  answer: { skill: "explain", doc: "docs/desk.md", does: "answer a question about how the product works or why" },
  show: { skill: "show-me", does: "answer \"show me how it looks\" with a picture of the product in that state" },
  map: { doc: "docs/map.md", does: "the product map: every main screen, how to get there, why it is like it is" },
  digest: { doc: "docs/digest.md", does: "the weekly digest of the product's UX and the themes in people's feedback" },
  "issue-news": { doc: "docs/issues.md", does: "the Issues page: what each planned issue will need on the screens" },
  sketch: { skill: "variants", fallback: "options", doc: "docs/issues.md", does: "an issue's screen as it looks now and one sketch of how it could look" },
  research: { doc: "docs/requests.md", does: "issues, pull requests, history and earlier decisions behind a request" },
  triage: { doc: "docs/boundary.md", does: "what can be done as a design change, what needs a developer or a decision" },
  impact: { skill: "impact", does: "where else the same thing shows up and what a change touches, from earlier decisions" },
  options: { skill: "variants", doc: "docs/requests.md", does: "two or three design options in the product's look, on sample data" },
  revise: { skill: "variants", fallback: "options", doc: "docs/requests.md", does: "apply people's notes on elements to an option, as a new version" },
  prototype: { doc: "docs/prototype.md", does: "a live prototype: the product with the design change, in an Environment" },
  spec: { doc: "docs/handoff.md", does: "the developer spec of an approved design" },
  deliver: { skill: "handoff-github", doc: "docs/handoff.md", does: "send the spec on: the origin issue, a coding agent, an issue or a draft pull request" },
  "bug-intake": { skill: "intake-slack", does: "put a UI bug reported on a channel on the Desk's queue" },
  "request-intake": { skill: "intake-slack", doc: "docs/requests.md", does: "put a design asked for on a channel on the Desk's queue; answer in its thread" },
  "figma-import": { skill: "figma", does: "bring a Figma frame in as a design option built from the product's parts" },
  "figma-export": { skill: "figma", does: "send a design option to Figma as editable layers" },
  "share-options": { skill: "slack-polls", does: "post a request's options to Slack for votes and comments" },
  "send-designs": { skill: "slack-polls", does: "post pictures of a request's options to its Slack thread or the channel" },
  "poll-sync": { skill: "slack-polls", does: "bring Slack votes and replies to the Desk; close a vote with its result" },
  council: { skill: "slack-council", does: "turn each ask in a request's Slack thread into a new option or version, answered there before/after" },
  catalog: { doc: "docs/catalog.md", does: "draw a real UI element in every state" },
  brief: { doc: "docs/desk.md", does: "the brief of an item on the presentation" },
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

// The skills a person switches on or off for one request in New request (`request_skills`,
// a comma list): the installed ones only, `figma` only with Figma on. A bundled skill says
// what it adds in plain words and whether it starts on; any other one, a product's own of
// the same name included, shows the first sentence of its description and starts off.
// Real paths on both sides: on the platform ~/.claude/skills is a link to ~/.agents/skills.
const real = (p) => { try { return realpathSync(p); } catch { return absolute(p); } };
const BUNDLED = real(join(TOOLKIT, "..", ".agents/skills"));
export const SWITCHES = {
  copy: ["Write the words: labels, empty states, errors", true],
  impact: ["Show where else the same thing appears", true],
  brand: ["Use a saved brand: its colours, fonts and logo", false],
  walkthrough: ["Add a clickable step-by-step tour of the options", false],
  figma: ["Also send the options to Figma as layers", false],
};
export function requestSkills(list, { figma = false, paths = skillPaths(), warn = () => {} } = {}) {
  const names = String(list || "").split(",").map((n) => n.trim()).filter((n) => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(n));
  const out = [];
  for (const name of [...new Set(names)].slice(0, 20)) {
    if (name === "figma" && !figma) continue;
    const path = findSkill(name, paths);
    if (!path) continue;
    const bundled = BUNDLED === real(join(path, "..", ".."));
    let [does, on] = bundled && SWITCHES[name] || ["", false];
    if (!does) {
      try {
        const head = readFileSync(path, "utf8").split(/\n---/)[0];
        const d = (head.match(/(?:^|\n)description:\s*(?:>-?|\|-?)?\s*([\s\S]*?)(?=\n\S[\w-]*:|$)/)?.[1] || "").replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
        const first = d.match(/^.*?[.!?](?=\s|$)/)?.[0] || d;
        does = first.length > 140 ? `${first.slice(0, 137).replace(/\s+\S*$/, "")}…` : first;
      } catch (e) { warn(`${name}: its description could not be read (${e.message}); the page shows its name`); }
    }
    out.push({ name, does, on });
  }
  return out;
}
