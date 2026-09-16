import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { mountFrontend } from "../server/frontend.js";

test("Generated frontend assets serve without uploaded CDN inputs; missing files never return HTML", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cardio-frontend-"));
  await mkdir(path.join(dir, "assets"));
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><h1>Cardio Flow</h1>",
  );
  await writeFile(
    path.join(dir, "assets", "index-build123.js"),
    "window.cardioReady=true;",
  );
  await writeFile(
    path.join(dir, "assets", "index-build123.css"),
    "body{color:green}",
  );
  const app = express();
  mountFrontend(app, dir);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const home = await fetch(base + "/");
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("cache-control"), "no-store");
    for (const extension of ["js", "css"]) {
      const asset = await fetch(base + `/assets/index-build123.${extension}`);
      assert.equal(asset.status, 200);
      assert.match(
        asset.headers.get("content-type")!,
        extension === "js" ? /javascript/ : /text\/css/,
      );
      assert.match(asset.headers.get("cache-control")!, /immutable/);
      assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
    }
    for (const file of [
      "missing.js",
      "index-build123.js.map",
      "index-build123.json",
      "%2e%2e%2findex.html",
    ]) {
      const asset = await fetch(base + "/assets/" + file);
      assert.equal(asset.status, 404);
      assert.match(asset.headers.get("content-type")!, /text\/plain/);
      assert.equal(await asset.text(), "File not found");
    }
    const deep = await fetch(base + "/patients/example");
    assert.equal(deep.status, 200);
    assert.match(await deep.text(), /Cardio Flow/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
});
