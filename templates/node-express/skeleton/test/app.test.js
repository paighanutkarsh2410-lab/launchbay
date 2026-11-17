import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { app } from "../src/app.js";

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("healthz answers ok", async () => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("root names the service", async () => {
  const body = await (await fetch(base)).json();
  assert.equal(body.service, "[[name]]");
});
