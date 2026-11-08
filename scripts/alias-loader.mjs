import path from "node:path";
import { pathToFileURL } from "node:url";

const srcRoot = pathToFileURL(
  path.resolve(import.meta.dirname, "../src") + path.sep,
);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const file = new URL(`${relative}.ts`, srcRoot);
    return nextResolve(file.href, context);
  }
  return nextResolve(specifier, context);
}
