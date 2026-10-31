// design desk <command> — the agent's side of the Desk. Every write goes through the
// Desk server (its store has one writer), authenticated by work/desk/.agent-token.
// Text comes from files (or - for stdin), never from argv. Prints JSON on stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { WORK, fail } from "../lib/core.mjs";

const USAGE = `usage: design desk <command>
  health                                   is the server up; store counts
  inbox                                    open and claimed inbox items
  item <I-n>                               one inbox item with its card
  claim <I-n> --session <id> [--takeover]  claim an item for this run (or DESK_SESSION)
  done <I-n> --session <id> [--outcome <text>]
                                           mark a claimed item done, with the same id
  cards [--kind change|request]            list cards
  card <C-n>                               one card with its threads
  upsert <card.json|->                     create or update a card (agent fields only)
  request <request.json|->                 file a request the agent opens (an issue's feature, a proposal):
                                           {type, title, problem, goal, from, origin, screens}
  agenda <C-n> [--note <text>]             put a card on the next call's agenda
  report <bug.json|->                      put a UI bug someone reported on the queue as a request
                                           of type bug: {title, problem, goal, steps, screen,
                                           screens: [{asset, caption}], origin: {channel, chat,
                                           thread_ts, message_ts, reporter}}
  asset <file> --kind <k> [--card C-n] [--name <n>] [--type <media/type>]
                                           store a file; kinds: screen variant spec patch image report
  answer <T-n> <text-file|-> [--resolve]   answer a question thread
  comment <C-n> <text-file|->              add a comment thread as the agent
  ask <C-n> <text-file|-> --step <step>    ask the people a question the step cannot go on without;
                                           their answer re-queues the step (request explore revise
                                           build handoff figma)
  decision <decision.json|->               record a decision: {concepts, text, why, source: {label,
                                           url, card}, at}
  decisions [--concept <c>] [--q <words>]  earlier decisions, newest first
  fetch <A-n> <file>                       save an asset (an option's page, a screen) to a file
  poll-open <C-n> <poll.json|->            record a Slack vote just posted: {chat, root_ts, posts:
                                           [{variant, ts}], closes, url, channel}
  poll-update <C-n> <P-n> [--synced <iso>] [--result <text>]
                                           mark a poll synced, or close it with its result
  slack-votes <C-n> <votes.json|->         one option's reactions as they are now: {variant,
                                           voters: [{email, slack_id, name, vote}]}
  relay <C-n> <comment.json|->             a reply under an option in Slack, as a comment, once:
                                           {variant, name, email, text, slack_ts, url}
  find-poll <ts>                           which card, poll and option a Slack message belongs to
  find-finding <ref>                       the request an automated test finding was already filed as
  enqueue <kind> <C-n> [--note <text>]     put work on the inbox (e.g. teardown)
`;

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".html": "text/html", ".md": "text/markdown", ".patch": "text/x-diff", ".diff": "text/x-diff", ".json": "application/json", ".txt": "text/plain" };

function readArg(p) {
  if (!p) fail("give the text as a file, or - for stdin");
  try { return p === "-" ? readFileSync(0, "utf8") : readFileSync(p, "utf8"); } catch (e) { fail(`cannot read ${p}: ${e.code || e.message}`); }
}

const BOOLEAN = new Set(["resolve", "takeover"]);
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
      return out(await call("POST", `/agent/items/${pos[0]}/claim`, { session, takeover: Boolean(f.takeover) }));
    case "done":
      if (!session) fail("pass --session <the id you claimed with> (docs/desk.md → Claims)");
      return out(await call("POST", `/agent/items/${pos[0]}/done`, { session, outcome: f.outcome || "done" }));
    case "cards": return out(await call("GET", `/agent/cards${f.kind ? `?kind=${encodeURIComponent(f.kind)}` : ""}`));
    case "card": return out(await call("GET", `/agent/cards/${pos[0]}`));
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
    case "answer": return out(await call("POST", `/agent/threads/${pos[0]}/answer`, { text: readArg(pos[1]), resolve: Boolean(f.resolve) }));
    case "comment": return out(await call("POST", `/agent/cards/${pos[0]}/comment`, { text: readArg(pos[1]) }));
    case "ask": return out(await call("POST", `/agent/cards/${pos[0]}/ask`, { text: readArg(pos[1]), step: typeof f.step === "string" ? f.step : "" }));
    case "decision": return out(await call("POST", "/agent/decisions", JSON.parse(readArg(pos[0]))));
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
    case "find-finding": return out(await call("GET", `/agent/findings?ref=${encodeURIComponent(pos[0] || "")}`));
    case "decisions": return out(await call("GET", `/agent/decisions?concept=${encodeURIComponent(typeof f.concept === "string" ? f.concept : "")}&q=${encodeURIComponent(typeof f.q === "string" ? f.q : "")}`));
    case "enqueue": return out(await call("POST", "/agent/enqueue", { kind: pos[0], card: pos[1], note: typeof f.note === "string" ? f.note : "" }));
    default: process.stdout.write(USAGE); process.exit(sub ? 2 : 0);
  }
}
