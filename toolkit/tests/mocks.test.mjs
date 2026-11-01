// node --test toolkit/tests/mocks.test.mjs — module stubs for rendering a component in a state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportNames, stubSource } from "../lib/mocks.mjs";

test("export names are read from the source", () => {
  const src = `export function useKeptWorkCount(id: string) { return 1; }
export const agentsQuery = () => 1;
export default function X() {}
export { a, b as c } from "./x";
export type T = string;`;
  assert.deepEqual(exportNames(src, "m.ts").names.sort(), ["a", "agentsQuery", "c", "default", "useKeptWorkCount"].sort());
});

test("a stub answers from the state, then by the export's name", async () => {
  const src = stubSource(["useKeptWorkCount", "useAgentsQuery", "useDeleteAgent", "useThing", "trpc", "Banner"]);
  const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  globalThis.__deskMocks = { useKeptWorkCount: 3 };
  assert.equal(mod.useKeptWorkCount("a"), 3);
  assert.equal(mod.useAgentsQuery().isLoading, false);
  assert.equal(typeof mod.useDeleteMutation, "undefined");
  assert.equal(mod.useThing(), undefined);
  assert.equal(typeof mod.trpc.agents.list.queryKey, "function");
  assert.equal(mod.Banner(), null);
  globalThis.__deskMocks = {};
});
