// design figma <command> — read a design from Figma's REST API (the figma skill). Read only;
// prints JSON on stdout.
import { writeFileSync } from "node:fs";
import { fail } from "../lib/core.mjs";
import { parseLink, summarize, framesOf, get } from "../lib/figma.mjs";

const USAGE = `usage: design figma <command>
  link <url>                         the file key and node a Figma link names
  frames <file-url> [--name <words>] the file's pages and what sits on them (frames, sections, components),
                                     each with its link; --name keeps those whose page, section or name has
                                     every word
  components <file-url>              the file's published components, each with the code it links to
                                     (Dev Mode links, when the team added them)
  frame <frame-url>                  what the frame is made of, to compare with the product: colours, type,
                                     spacing, corners, component instances, texts, and a hash that changes
                                     when any of it does
  render <frame-url> <out.png> [--scale 2]
                                     the frame as a picture
`;

const flag = (args, name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = (x) => process.stdout.write(JSON.stringify(x, null, 1) + "\n");
const linkOf = (url, needNode = false) => {
  const l = parseLink(url);
  if (!l) fail(`not a Figma link: ${url || "(none)"}`);
  if (needNode && !l.node) fail("the link names no frame: in Figma, right-click the frame → Copy link");
  return l;
};

export async function main(_cmd, args) {
  const [sub, ...rest] = args;
  const pos = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  try {
    if (sub === "link") return out(linkOf(pos[0]));
    if (sub === "frames") {
      const l = linkOf(pos[0]);
      const file = await get(`/v1/files/${l.key}?depth=3`);
      return out({ file: file.name, version: file.version, edited: file.lastModified, frames: framesOf(file, l.key, flag(rest, "--name", "")) });
    }
    if (sub === "components") {
      const l = linkOf(pos[0]);
      // Dev Mode links may be refused (a seat without Dev Mode): the components still list, and
      // `code_links` says the links could not be read, so no link is not taken for none.
      let linksError = null;
      const [c, d] = await Promise.all([get(`/v1/files/${l.key}/components`), get(`/v1/files/${l.key}/dev_resources`).catch((e) => { linksError = e.message; return { dev_resources: [] }; })]);
      const code = new Map();
      for (const r of d.dev_resources || []) code.set(r.node_id, [...(code.get(r.node_id) || []), { name: r.name, url: r.url }]);
      return out({ code_links: linksError ? `unavailable: ${linksError}` : "read", components: (c.meta?.components || []).map((x) => ({ name: x.name, set: x.containing_frame?.containingComponentSet?.name || null, node: x.node_id, description: x.description || "", code: code.get(x.node_id) || [] })) });
    }
    if (sub === "frame") {
      const l = linkOf(pos[0], true);
      const r = await get(`/v1/files/${l.key}/nodes?ids=${encodeURIComponent(l.node)}`);
      const n = r.nodes?.[l.node];
      if (!n?.document) fail(`no frame ${l.node} in the file`);
      return out({ url: l.url, file: r.name, version: r.version, edited: r.lastModified, ...summarize(n.document, n.components || {}) });
    }
    if (sub === "render") {
      const l = linkOf(pos[0], true);
      if (!pos[1]) fail("render needs an output file");
      const scale = Number(flag(rest, "--scale", "2")) || 2;
      const r = await get(`/v1/images/${l.key}?ids=${encodeURIComponent(l.node)}&format=png&scale=${scale}`);
      const src = r.images?.[l.node];
      if (!src) fail(`Figma drew no picture of ${l.node}${r.err ? `: ${r.err}` : ""}`);
      // The picture comes from Figma's storage host, not the API: the egress must allow it, so a
      // refusal names that host.
      const host = new URL(src).host;
      let img;
      try { img = await fetch(src); } catch (e) { fail(`the picture could not be downloaded from ${host} (${e.cause?.code || e.message}); allow ${host} in the egress`); }
      if (!img.ok) fail(`the picture could not be downloaded from ${host} (${img.status}); allow ${host} in the egress`);
      writeFileSync(pos[1], Buffer.from(await img.arrayBuffer()));
      return out({ file: pos[1], node: l.node, scale });
    }
  } catch (e) { fail(e.message); }
  process.stdout.write(USAGE);
  process.exit(sub ? 2 : 0);
}
