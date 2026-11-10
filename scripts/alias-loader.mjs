import path from "node:path";
import { pathToFileURL } from "node:url";

const srcRoot = pathToFileURL(
  path.resolve(import.meta.dirname, "../src") + path.sep,
);

const serverOnlyStub = new URL("./server-only-stub.mjs", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: serverOnlyStub.href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const file = new URL(`${relative}.ts`, srcRoot);
    return nextResolve(file.href, context);
  }
  return nextResolve(specifier, context);
}
