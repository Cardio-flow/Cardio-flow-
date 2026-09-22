import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

test("Shared server/browser models load as emitted Node ESM without a TS resolver", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cardio-shared-runtime-"));
  try {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    for (const name of [
      "guided",
      "clinical-review",
      "care-model",
      "registry-forms",
      "clinical-foundation",
    ]) {
      const source = await readFile(
        new URL(`../src/${name}.ts`, import.meta.url),
        "utf8",
      );
      const output = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2023,
        },
      }).outputText;
      await writeFile(path.join(dir, `${name}.js`), output);
    }
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const check = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {templates} from './guided.js'; import './registry-forms.js'; import './care-model.js'; import './clinical-foundation.js'; if(templates.length<70) process.exit(2);",
      ],
      { cwd: dir, encoding: "utf8", env },
    );
    assert.equal(
      check.status,
      0,
      check.stderr || check.error?.message || "Emitted module failed to load",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
