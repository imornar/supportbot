import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clientImportsOfServerModules,
  readSourceFiles,
} from "@/server/client-boundary";

const srcRoot = path.join(process.cwd(), "src");

describe("client and server boundary", () => {
  it("flags a client module that imports server code", () => {
    const violations = clientImportsOfServerModules(
      [
        {
          path: path.join(srcRoot, "app", "widget.tsx"),
          source: `"use client";\nimport { getPublicEnv } from "@/server/env";\n`,
        },
        {
          path: path.join(srcRoot, "app", "panel.tsx"),
          source: `"use client";\nimport { databaseReadiness } from "../server/env";\n`,
        },
      ],
      srcRoot,
    );

    expect(violations).toHaveLength(2);
  });

  it("allows a client module that stays on the client", () => {
    const violations = clientImportsOfServerModules(
      [
        {
          path: path.join(srcRoot, "app", "widget.tsx"),
          source: `"use client";\nimport { useState } from "react";\n`,
        },
      ],
      srcRoot,
    );

    expect(violations).toEqual([]);
  });

  it("finds no client imports of server modules in src", () => {
    expect(
      clientImportsOfServerModules(readSourceFiles(srcRoot), srcRoot),
    ).toEqual([]);
  });
});
