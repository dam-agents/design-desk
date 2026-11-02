// design config <command> — the one way to change work/CONFIG.md by hand (docs/config.md →
// Writing the file): read its fingerprint, edit a copy, write the copy back only when
// nobody wrote the file in between. Every write holds work/.CONFIG.lock.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, fail, configSha, writeConfig } from "../lib/core.mjs";

const USAGE = `usage: design config <command>
  sha                                   the fingerprint of work/CONFIG.md as it is now (missing: of
                                        an empty file, so a first write creates it)
  write <file> --from <sha>             replace work/CONFIG.md with <file>, under the lock, only
                                        when it still has that fingerprint; exit 3 when it changed
`;

// The refusal a changed file gets: the caller reads it again and makes its change anew.
export class Changed extends Error {}
export function writeIfUnchanged(work, next, from) {
  return writeConfig(work, (text) => {
    if (configSha(text) !== from) throw new Changed("work/CONFIG.md changed since you read it: read it again and redo your change");
    return next;
  });
}

export async function main(_cmd, argv) {
  const [sub, file, flag, from] = argv;
  if (sub === "sha") {
    let text = "";
    try { text = readFileSync(join(WORK, "CONFIG.md"), "utf8"); } catch (e) { if (e.code !== "ENOENT") fail(`cannot read work/CONFIG.md (${e.code || e.message})`); }
    return console.log(configSha(text));
  }
  if (sub === "write" && file && flag === "--from" && /^[0-9a-f]{64}$/.test(from || "")) {
    let next; try { next = readFileSync(file, "utf8"); } catch (e) { fail(`cannot read ${file} (${e.code || e.message})`); }
    try { writeIfUnchanged(WORK, next, from); } catch (e) { console.error(`design: ${e.message}`); process.exit(e instanceof Changed ? 3 : 1); }
    return console.log(JSON.stringify({ written: true, sha: configSha(next) }));
  }
  process.stdout.write(USAGE); process.exit(sub ? 2 : 0);
}
