// design states <file.tsx> [--export <Component>] [--root <repo clone>]
// The dimensions of a component's states, from the TypeScript checker: props and their
// values, the fields it reads, the conditions it branches on, the hooks it calls and
// the components it renders. Prints JSON; docs/catalog.md turns it into a state sheet.
import { resolve } from "node:path";
import { fail } from "../lib/core.mjs";
import { componentStates, findTsconfig } from "../lib/states.mjs";

export async function main(_cmd, argv) {
  const pos = []; let exportName = "", root = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--export") exportName = argv[++i];
    else if (argv[i] === "--root") root = argv[++i];
    else pos.push(argv[i]);
  }
  if (!pos[0]) fail("usage: design states <file.tsx> [--export <Component>] [--root <repo clone>]");
  const file = resolve(pos[0]);
  try {
    const out = componentStates(file, { exportName, tsconfig: findTsconfig(file, root ? resolve(root) : "/"), root: root ? resolve(root) : "" });
    console.log(JSON.stringify(out, null, 1));
  } catch (e) { fail(e.message); }
}
