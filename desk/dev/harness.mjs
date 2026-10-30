#!/usr/bin/env node
// Development only: serves the Desk page with a stand-in for the platform bridge, so
// the page can be opened in a local browser against a local Desk server.
//   DESK_PORT=5599 node desk/server.mjs &
//   node desk/dev/harness.mjs 5600 5599
//   open "http://localhost:5600/?as=alice@example.com"            (a viewer)
//   open "http://localhost:5600/?as=owner@example.com&role=owner"  (the owner)
// The stand-in sets the caller headers the platform's relay would set. It is never
// part of a deployment.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [port = "5600", deskPort = "5599"] = process.argv.slice(2);
const page = join(dirname(fileURLToPath(import.meta.url)), "..", "page.html");

const shim = `<script>
window.platform = (() => {
  const q = new URLSearchParams(location.search);
  const as = q.get("as") || "alice@example.com", role = q.get("role") || "viewer";
  return Object.freeze({
    sendPrompt(p) { console.log("[sendPrompt]", p); },
    async request({ method, path, body, contentType }) {
      const r = await fetch("/relay" + path, { method, body, headers: { "content-type": contentType || "text/plain", "x-as": as, "x-role": role } });
      return { status: r.status, contentType: r.headers.get("content-type"), body: await r.text() };
    },
    async whoami() { return { role, email: as, sub: "dev-" + as }; },
  });
})();
</script>`;

createServer(async (req, res) => {
  if (req.url.startsWith("/relay/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const as = String(req.headers["x-as"] || ""), role = String(req.headers["x-role"] || "viewer");
    const r = await fetch(`http://127.0.0.1:${deskPort}${req.url.slice("/relay".length)}`, {
      method: req.method, body: chunks.length ? Buffer.concat(chunks) : undefined,
      headers: { "content-type": "application/json", "x-platform-caller-role": role, "x-platform-caller-email": as, "x-platform-caller-sub": `dev-${as}` },
    });
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json" });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(page, "utf8").replace("<head>", `<head>${shim}`));
}).listen(Number(port), "127.0.0.1", () => console.error(`harness on http://localhost:${port} → desk 127.0.0.1:${deskPort}`));
