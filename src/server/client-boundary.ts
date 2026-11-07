import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const useClientPattern = /(?:^|\n)\s*['"]use client['"]/;

const specifierPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

export type SourceFile = {
  path: string;
  source: string;
};

export function listSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

export function readSourceFiles(directory: string): SourceFile[] {
  return listSourceFiles(directory).map((filePath) => ({
    path: filePath,
    source: readFileSync(filePath, "utf8"),
  }));
}

export function clientImportsOfServerModules(
  files: SourceFile[],
  srcRoot: string,
): string[] {
  const serverRoot = path.normalize(path.join(srcRoot, "server"));
  const violations: string[] = [];

  for (const file of files) {
    if (!useClientPattern.test(file.source)) {
      continue;
    }

    for (const specifier of specifiersIn(file.source)) {
      if (isServerSpecifier(specifier, file.path, serverRoot)) {
        violations.push(`${file.path} imports ${specifier}`);
      }
    }
  }

  return violations;
}

function specifiersIn(source: string): string[] {
  return [...source.matchAll(specifierPattern)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

function isServerSpecifier(
  specifier: string,
  importerPath: string,
  serverRoot: string,
): boolean {
  if (specifier === "server-only" || specifier.startsWith("@/server")) {
    return true;
  }

  if (!specifier.startsWith(".")) {
    return false;
  }

  const resolved = path.normalize(
    path.join(path.dirname(importerPath), specifier),
  );
  return (
    resolved === serverRoot || resolved.startsWith(`${serverRoot}${path.sep}`)
  );
}
