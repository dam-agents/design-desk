// design desk <command> — the agent's side of the Desk. Every write goes through the
// Desk server (its store has one writer), authenticated by work/desk/.agent-token.
// Text comes from files (or - for stdin), never from argv. Prints JSON on stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { WORK, fail, run, tableIn, withRosterRow, writeConfig } from "../lib/core.mjs";
import { ADDABLE_ROLES, rosterOf } from "../../desk/store.mjs";

const USAGE = `usage: design desk <command>
  health                                   is the server up; store counts
  inbox                                    open and claimed inbox items
  item <I-n>                               one inbox item with its card
  claim <I-n> --session <id> [--takeover|--heartbeat]
                                           claim it; --takeover takes an expired lease,
                                           --heartbeat renews your own claim
  done <I-n> --session <id> [--outcome <text>]
                                           mark a claimed item done, with the same id
  person <I-n> --session <id>              work a lead's ask to add a person: re-check it, add the
                                           row to ## Desk people, and mark the item done
  cards [--kind change|request|issue]      list cards
  card <C-n>                               one card with its threads
  designs                                  every approved design: where its spec went, its option
                                           and its elements (docs/watch.md step 11)
  upsert <card.json|->                     create or update a card (agent fields only)
  request <request.json|->                 file a request the agent opens (an issue's feature, a proposal):
                                           {type, title, problem, goal, from, origin, screens}
  agenda <C-n> [--note <text>]             suggest a card for the presentation; a designer adds it
  look <C-n> <look.json|->                 add an earlier look of an element or a screen, drawn from the
                                           code's history: {at, commit, sheet, thumb, states, made_by,
                                           links: [{label, url}], note} (a screen: screens instead of sheet)
  report <bug.json|->                      put a UI bug someone reported on the queue as a request
                                           of type bug: {title, problem, goal, steps, screen,
                                           screens: [{asset, caption}], origin: {channel, chat,
                                           thread_ts, message_ts, reporter, email, url}}
  asset <file> --kind <k> [--card C-n] [--name <n>] [--type <media/type>]
                                           store a file; kinds: screen variant spec patch image report
  answer <T-n> <text-file|-> [--resolve] [--shots <shots.json>] [--warns <warns.json>]
                                           answer a thread; --shots: what a worked-in change did,
                                           as design compare prints it with assets: [{asset, caption,
                                           stage: before|after|diff, pair, marks}]; --warns: what it
                                           goes against: [{what, why, source: {kind: decision, ref:
                                           D-n} | {kind: issue|pr, url, label}}]
  comment <C-n> <text-file|-> [--shots <shots.json>]
                                           add a comment thread as the agent
  ask <C-n> <text-file|-> --step <step>    ask the people a question the step cannot go on without;
      [--form]                             their answer re-queues the step (request explore revise states
                                           build handoff figma catalog map); --form: the file is
                                           JSON {text, questions: [{text, why, options, suggested}]},
                                           a form
  decision <decision.json|->               record a decision (docs/desk.md → Decisions): {concepts, text,
                                           why, author: {name, login, email, role}, origin: {kind, label, url,
                                           card, thread, message}, at, replaces: [D-n], conflicts:
                                           [{decision, why}]}
  decision-show <D-n>                      one decision with what cites it or goes against it
  decision-revoke <D-n> <revoke.json|->    revoke a decision as a person did: {reason, by: {name, login,
                                           email}, origin: {kind, label, url, card}, replaced_by}
  decisions [--concept <c>] [--q <words>] [--state active|revoked]
                                           earlier decisions, newest first
  decision-check <C-n> [--concept <a,b>] [--q <words>]
                                           what a check reads (docs/desk.md → Decisions → The check):
                                           the card's options, the decisions in force it could go
                                           against, its conflicts now and its last check
  fetch <A-n> <file>                       save an asset (an option's page, a screen) to a file
  poll-open <C-n> <poll.json|->            record a Slack vote just posted: {chat, root_ts, posts:
                                           [{variant, ts}], closes, url, channel}
  poll-update <C-n> <P-n> [--synced <iso>] [--result <text>]
                                           mark a poll synced, or close it with its result
  slack-votes <C-n> <votes.json|->         one option's reactions as they are now: {variant,
                                           voters: [{email, slack_id, name, vote, is_bot}]};
                                           a voter with is_bot: true (the agent's own legend
                                           👍/👎/⚠️) is ignored
  relay <C-n> <comment.json|->             a reply in Slack, as a comment, once: {variant (none for
                                           a council thread), name, email, text, slack_ts, url,
                                           mentions: {<Slack user id>: name}}; a mention without
                                           a name is left out
  find-poll <ts>                           which card, poll and option a Slack message belongs to
  council-open <C-n> <council.json|->      record a Slack thread whose asks change the request's options:
                                           {chat, thread_ts, url, channel}; reopens a closed one
  council-update <C-n> <S-n> [--synced <iso>] [--seen <ts>] [--result <text>]
                                           mark a council read up to a Slack ts, or close it with its result
  find-council <thread ts>                 which card and council a Slack thread belongs to; with no
                                           council, the request the thread filed ({council: null})
  find-finding <ref>                       the request an automated test finding was already filed as
  enqueue <kind> <C-n> [--note <text>]     put work on the inbox (e.g. teardown)
  github-sync [--card <C-n>]               read every issue and pull request the cards point at (or one
                                           card's) on GitHub with its comments and keep it on the Desk;
                                           prints {synced, failed, fresh: [{key, cards, comments}]}, the
                                           comments new since the last read
  github <owner/repo#n>[,…]                what the Desk keeps of them
  github-mark <owner/repo#n> --at <iso> --author <login> [--off]
                                           mark an issue's comment as about the design or the UI (the
                                           only ones its preview shows); --off takes the mark back
`;

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".html": "text/html", ".md": "text/markdown", ".patch": "text/x-diff", ".diff": "text/x-diff", ".json": "application/json", ".txt": "text/plain" };

function readArg(p) {
  if (!p) fail("give the text as a file, or - for stdin");
  try { return p === "-" ? readFileSync(0, "utf8") : readFileSync(p, "utf8"); } catch (e) { fail(`cannot read ${p}: ${e.code || e.message}`); }
}

const BOOLEAN = new Set(["resolve", "takeover", "heartbeat", "form"]);
function flags(argv) {
  const pos = [], f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (BOOLEAN.has(k)) f[k] = true;
    else if (i + 1 < argv.length) f[k] = argv[++i];
    else fail(`--${k} needs a value`);
  }
  return { pos, f };
}

export async function call(method, path, body) {
  const port = Number(process.env.DESK_PORT || 5555);
  const dir = process.env.DESK_DIR || join(WORK, "desk");
  let token = "";
  try { token = readFileSync(join(dir, ".agent-token"), "utf8").trim(); } catch { fail(`no agent token in ${dir}: the Desk server has never started — start it (docs/desk.md → Server)`); }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json", "x-desk-agent-token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { fail(`the Desk server is not answering on 127.0.0.1:${port} (${e.cause?.code || e.message}) — docs/desk.md → Server`); }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { error: text }; }
  if (!res.ok) { console.log(JSON.stringify({ ok: false, status: res.status, ...json })); process.exit(res.status === 409 ? 3 : 1); }
  return json;
}

const out = (o) => console.log(JSON.stringify(o, null, 1));
// The before and after pictures of a change (docs/requests.md → revise), as `design compare`
// prints them: a picture given as a `file` is stored first and goes as its asset.
async function shotsArg(file) {
  if (typeof file !== "string") return null;
  let list; try { list = JSON.parse(readFileSync(file, "utf8")); } catch (e) { fail(`--shots: not JSON (${e.message})`); }
  if (!Array.isArray(list)) list = list?.shots;
  if (!Array.isArray(list)) fail("--shots: a list of pictures, or design compare's output");
  const shots = [];
  for (const { file: pic, ...s } of list) {
    if (s.asset || !pic) { shots.push(s); continue; }
    const { asset } = await call("POST", "/agent/assets", { card: null, kind: "image", name: basename(pic), contentType: TYPES[extname(pic).toLowerCase()] || "image/jpeg", encoding: "base64", data: readFileSync(pic).toString("base64") });
    shots.push({ ...s, asset: asset.id });
  }
  return shots;
}

// A lead's ask to add a person (docs/desk.md → People), decided on work/CONFIG.md as it
// is now: the row already there with that role is `added` (a run that wrote it and died
// before done); otherwise the asker is the owner or still a lead, and the role one a lead
// may give. `{ write: true }` when the row is still to be added.
export function personVerdict(item, text) {
  const { email, role } = item.person;
  const roster = rosterOf(tableIn(text, "Desk people"));
  const on = roster.find((r) => r.email === email);
  if (on) return { outcome: on.role === role ? "added" : `not added: ${email} is already on the list.` };
  const asker = roster.find((r) => r.email === String(item.by?.email || "").toLowerCase());
  if (!item.by?.owner && asker?.role !== "lead") return { outcome: `not added: ${item.by?.email || "the person who asked"} is no longer a lead.` };
  if (!ADDABLE_ROLES.includes(role)) return { outcome: `not added: a lead cannot give the role ${role}.` };
  return { write: true };
}

// A file that cannot be read, or a row that cannot be written, ends the command with an
// error and leaves the item claimed: the next run takes it over and tries again.
async function person(id, session) {
  const { item } = await call("GET", `/agent/items/${id}`);
  if (item.kind !== "person" || !item.person) fail(`${id} is not an ask to add a person`);
  const { email, role } = item.person;
  const read = () => { try { return readFileSync(join(WORK, "CONFIG.md"), "utf8"); } catch (e) { fail(`cannot read work/CONFIG.md (${e.code || e.message}); ${id} stays claimed for the next run`); } };
  let verdict = personVerdict(item, read());
  if (verdict.write) {
    try { addRosterRow(WORK, email, role); verdict = { outcome: "added" }; }
    catch (e) {
      verdict = personVerdict(item, read());
      if (verdict.write) fail(`cannot add the row: ${e.message}; ${id} stays claimed for the next run`);
    }
  }
  await call("POST", `/agent/items/${id}/done`, { session, outcome: verdict.outcome });
  return { item: id, email, role, outcome: verdict.outcome };
}

// One issue or pull request as GitHub has it now: its text, labels and every comment, a
// pull request's reviews among them (docs/desk.md → GitHub on the Desk).
export function ghRecord(key, gh = (args) => run("gh", args)) {
  const [repo, n] = key.split("#");
  const api = (path) => { const r = gh(["api", "--paginate", "--slurp", path]); if (r.status !== 0) throw new Error((r.stderr || "").trim().split("\n")[0] || `gh api ${path} failed`); return JSON.parse(r.stdout).flat(); };
  const [it] = api(`repos/${repo}/issues/${n}`);
  const pr = Boolean(it.pull_request);
  const said = api(`repos/${repo}/issues/${n}/comments`).map((c) => ({ author: c.user?.login || "", at: c.created_at, url: c.html_url, body: c.body || "" }));
  const reviews = pr ? api(`repos/${repo}/pulls/${n}/reviews`).filter((v) => v.body).map((v) => ({ author: v.user?.login || "", at: v.submitted_at, url: v.html_url, body: `[review: ${v.state}] ${v.body}` })) : [];
  return { key, kind: pr ? "pr" : "issue", title: it.title, state: it.pull_request?.merged_at ? "merged" : it.state, url: it.html_url, author: it.user?.login || "",
    labels: (it.labels || []).map((l) => l.name), body: it.body || "", updated: it.updated_at, comments: [...said, ...reviews].sort((a, b) => String(a.at).localeCompare(String(b.at))) };
}
// `io` stands in for the Desk server and gh in a test.
export async function githubSync(card, io = { call, gh: undefined }) {
  const { refs } = await io.call("GET", `/agent/github${card ? `?card=${encodeURIComponent(card)}` : ""}`);
  const done = [], failed = [], fresh = [];
  for (let i = 0; i < refs.length; i += 5) {
    const batch = [];
    for (const key of refs.slice(i, i + 5)) { try { batch.push(ghRecord(key, io.gh)); } catch (e) { failed.push({ key, error: e.message }); } }
    if (!batch.length) continue;
    const r = await io.call("POST", "/agent/github", { records: batch });
    done.push(...batch.map((x) => x.key)); fresh.push(...r.fresh);
  }
  return { synced: done.length, failed, fresh };
}

// The row goes in through the one writer of work/CONFIG.md (docs/config.md).
export const addRosterRow = (work, email, role) => writeConfig(work, (text) => withRosterRow(text, email, role));

export async function main(_cmd, argv) {
  const [sub, ...rest] = argv;
  const { pos, f } = flags(rest);
  // An export does not survive between two commands of a harness, so the id travels
  // as a flag; the env var is the fallback for a shell that keeps it.
  const session = (typeof f.session === "string" && f.session) || process.env.DESK_SESSION || "";
  switch (sub) {
    case "health": return out(await call("GET", "/health"));
    case "inbox": return out(await call("GET", "/agent/inbox"));
    case "item": return out(await call("GET", `/agent/items/${pos[0]}`));
    case "claim":
      if (!session) fail("pass --session <this run's id> (docs/desk.md → Claims)");
      if (f.takeover && f.heartbeat) fail("--takeover and --heartbeat are different claims: pass one");
      return out(await call("POST", `/agent/items/${pos[0]}/claim`, { session, takeover: Boolean(f.takeover), heartbeat: Boolean(f.heartbeat) }));
    case "done":
      if (!session) fail("pass --session <the id you claimed with> (docs/desk.md → Claims)");
      return out(await call("POST", `/agent/items/${pos[0]}/done`, { session, outcome: f.outcome || "done" }));
    case "person": {
      if (!session) fail("pass --session <the id you claimed with> (docs/desk.md → Claims)");
      return out(await person(pos[0], session));
    }
    case "cards": return out(await call("GET", `/agent/cards${f.kind ? `?kind=${encodeURIComponent(f.kind)}` : ""}`));
    case "card": return out(await call("GET", `/agent/cards/${pos[0]}`));
    case "designs": return out(await call("GET", "/agent/designs"));
    case "upsert": {
      if (!pos[0]) fail("usage: design desk upsert <card.json|->");
      let doc; try { doc = JSON.parse(readArg(pos[0])); } catch (e) { fail(`not JSON: ${e.message}`); }
      return out(await call("POST", "/agent/cards", doc));
    }
    case "request": {
      if (!pos[0]) fail("usage: design desk request <request.json|->");
      let doc; try { doc = JSON.parse(readArg(pos[0])); } catch (e) { fail(`not JSON: ${e.message}`); }
      return out(await call("POST", "/agent/requests", doc));
    }
    case "agenda": return out(await call("POST", `/agent/cards/${pos[0]}/agenda`, { note: typeof f.note === "string" ? f.note : "" }));
    case "look": {
      if (!pos[0] || !pos[1]) fail("usage: design desk look <C-n> <look.json|->");
      let doc; try { doc = JSON.parse(readArg(pos[1])); } catch (e) { fail(`not JSON: ${e.message}`); }
      return out(await call("POST", `/agent/cards/${pos[0]}/looks`, doc));
    }
    case "report": {
      if (!pos[0]) fail("usage: design desk report <bug.json|->");
      let doc; try { doc = JSON.parse(readArg(pos[0])); } catch (e) { fail(`not JSON: ${e.message}`); }
      return out(await call("POST", "/agent/reports", doc));
    }
    case "asset": {
      const file = pos[0];
      if (!file || !f.kind) fail("usage: design desk asset <file> --kind <kind> [--card C-n] [--name <name>]");
      const type = f.type || TYPES[extname(file).toLowerCase()] || "application/octet-stream";
      const text = /^text\/|json|svg/.test(type);
      const buf = readFileSync(file);
      return out(await call("POST", "/agent/assets", {
        card: f.card || null, kind: f.kind, name: f.name || basename(file), contentType: type,
        encoding: text ? "utf8" : "base64", data: text ? buf.toString("utf8") : buf.toString("base64"),
      }));
    }
    case "answer": return out(await call("POST", `/agent/threads/${pos[0]}/answer`, { text: readArg(pos[1]), resolve: Boolean(f.resolve), shots: await shotsArg(f.shots), warns: typeof f.warns === "string" ? JSON.parse(readArg(f.warns)) : null }));
    case "comment": return out(await call("POST", `/agent/cards/${pos[0]}/comment`, { text: readArg(pos[1]), shots: await shotsArg(f.shots) }));
    case "ask": {
      const body = f.form ? JSON.parse(readArg(pos[1])) : { text: readArg(pos[1]) };
      return out(await call("POST", `/agent/cards/${pos[0]}/ask`, { text: body.text, questions: body.questions || null, step: typeof f.step === "string" ? f.step : "" }));
    }
    case "decision": return out(await call("POST", "/agent/decisions", JSON.parse(readArg(pos[0]))));
    case "decision-show": return out(await call("GET", `/agent/decisions/${encodeURIComponent(pos[0] || "")}`));
    case "decision-revoke": return out(await call("POST", `/agent/decisions/${encodeURIComponent(pos[0] || "")}/revoke`, JSON.parse(readArg(pos[1]))));
    case "fetch": {
      const a = await call("GET", `/agent/assets/${pos[0]}`);
      if (!pos[1]) fail("usage: design desk fetch <A-n> <file>");
      writeFileSync(pos[1], Buffer.from(a.data, a.encoding === "base64" ? "base64" : "utf8"));
      return out({ saved: pos[1], contentType: a.contentType, name: a.name });
    }
    case "poll-open": return out(await call("POST", `/agent/cards/${pos[0]}/polls`, JSON.parse(readArg(pos[1]))));
    case "poll-update": return out(await call("POST", `/agent/cards/${pos[0]}/polls/${pos[1]}`, { synced: typeof f.synced === "string" ? f.synced : null, result: typeof f.result === "string" ? f.result : null }));
    case "slack-votes": return out(await call("POST", `/agent/cards/${pos[0]}/slack-votes`, JSON.parse(readArg(pos[1]))));
    case "relay": return out(await call("POST", `/agent/cards/${pos[0]}/relay`, JSON.parse(readArg(pos[1]))));
    case "find-poll": return out(await call("GET", `/agent/polls?ts=${encodeURIComponent(pos[0] || "")}`));
    case "council-open": return out(await call("POST", `/agent/cards/${pos[0]}/councils`, JSON.parse(readArg(pos[1]))));
    case "council-update": return out(await call("POST", `/agent/cards/${pos[0]}/councils/${pos[1]}`, { synced: typeof f.synced === "string" ? f.synced : null, seen: typeof f.seen === "string" ? f.seen : null, result: typeof f.result === "string" ? f.result : null }));
    case "find-council": return out(await call("GET", `/agent/councils?ts=${encodeURIComponent(pos[0] || "")}`));
    case "find-finding": return out(await call("GET", `/agent/findings?ref=${encodeURIComponent(pos[0] || "")}`));
    case "decision-check": return out(await call("GET", `/agent/cards/${encodeURIComponent(pos[0] || "")}/decision-check?concept=${encodeURIComponent(typeof f.concept === "string" ? f.concept : "")}&q=${encodeURIComponent(typeof f.q === "string" ? f.q : "")}`));
    case "decisions": return out(await call("GET", `/agent/decisions?concept=${encodeURIComponent(typeof f.concept === "string" ? f.concept : "")}&q=${encodeURIComponent(typeof f.q === "string" ? f.q : "")}&state=${encodeURIComponent(typeof f.state === "string" ? f.state : "")}`));
    case "github-sync": return out(await githubSync(typeof f.card === "string" ? f.card : null));
    case "github": return out(await call("GET", `/agent/github?keys=${encodeURIComponent(pos[0] || "")}`));
    case "github-mark":
      if (typeof f.at !== "string" || typeof f.author !== "string") fail("pass --at <the comment's at> and --author <its login>, as github-sync's fresh gives them");
      return out(await call("POST", "/agent/github/marks", { key: pos[0] || "", at: f.at, author: f.author, design: !f.off }));
    case "enqueue": return out(await call("POST", "/agent/enqueue", { kind: pos[0], card: pos[1], note: typeof f.note === "string" ? f.note : "" }));
    default: process.stdout.write(USAGE); process.exit(sub ? 2 : 0);
  }
}
