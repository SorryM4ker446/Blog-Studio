import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToReadableStream } from "next/dist/compiled/react-server-dom-webpack/server.node.js";

const { requestServerJSON } = await import(pathToFileURL(process.argv[2]).href);
let version = 1;
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, cookie: options.headers.get("Cookie"), signal: options.signal });
  assert.equal(options.cache, "no-store");
  if (url.endsWith("/outage")) return new Response(null, { status: 503 });
  if (url.endsWith("/malformed")) return new Response("invalid JSON");
  if (url.endsWith("/timeout")) {
    return new Promise((_resolve, reject) => {
      const transport = setTimeout(() => reject(new Error("Transport did not abort")), 1000);
      options.signal.addEventListener("abort", () => {
        clearTimeout(transport);
        reject(options.signal.reason);
      }, { once: true });
    });
  }
  return Response.json({ version, cookie: options.headers.get("Cookie") });
};

async function render(reads) {
  let values;
  async function Component() {
    values = await Promise.all(reads());
    return JSON.stringify(values);
  }
  const stream = await renderToReadableStream(createElement(Component), {});
  await new Response(stream).text();
  return values;
}

const values = await render(() => [
  requestServerJSON("/settings"), requestServerJSON("/settings", { timeoutMs: 2000 }),
  requestServerJSON("/admin/me", { cookieHeader: "blog_session=first" }),
  requestServerJSON("/admin/me", { cookieHeader: "blog_session=first" }),
  requestServerJSON("/admin/me", { cookieHeader: "blog_session=second" }),
  requestServerJSON("/settings", { timeoutMs: 1000 }),
]);
assert.equal(calls.length, 4);
assert.equal(values[0], values[1]);
assert.equal(values[2], values[3]);
assert.equal(values[2].data.cookie, "blog_session=first");
assert.equal(values[4].data.cookie, "blog_session=second");
version = 2;
const next = await render(() => [requestServerJSON("/settings")]);
assert.equal(calls.length, 5);
assert.equal(next[0].data.version, 2);
const failures = await render(() => [
  requestServerJSON("/outage"), requestServerJSON("/outage"),
  requestServerJSON("/malformed"), requestServerJSON("/timeout", { timeoutMs: 10 }),
]);
assert.equal(calls.length, 8);
assert.deepEqual(failures, [
  { ok: false, status: 503 }, { ok: false, status: 503 },
  { ok: false, status: null }, { ok: false, status: null },
]);
assert.equal(calls.at(-1).signal.aborted, true);

// Keep two server renders in flight together to catch accidental process-wide sharing.
const concurrentCalls = [];
const pendingReads = [];
globalThis.fetch = async (url, options) => {
  concurrentCalls.push({ url, cookie: options.headers.get("Cookie") });
  return new Promise(resolve => pendingReads.push(resolve));
};
const firstRender = render(() => [requestServerJSON("/settings"), requestServerJSON("/settings"),
  requestServerJSON("/admin/me", { cookieHeader: "blog_session=first" })]);
const secondRender = render(() => [requestServerJSON("/settings"), requestServerJSON("/settings"),
  requestServerJSON("/admin/me", { cookieHeader: "blog_session=second" })]);
await new Promise(resolve => setImmediate(resolve));
assert.equal(concurrentCalls.length, 4);
assert.equal(concurrentCalls.filter(call => call.url.endsWith("/settings")).length, 2);
assert.deepEqual(concurrentCalls.filter(call => call.cookie).map(call => call.cookie).sort(),
  ["blog_session=first", "blog_session=second"]);
pendingReads.forEach((resolve, index) => resolve(Response.json({ snapshot: index })));
const [firstSnapshot, secondSnapshot] = await Promise.all([firstRender, secondRender]);
assert.equal(firstSnapshot[0], firstSnapshot[1]);
assert.equal(secondSnapshot[0], secondSnapshot[1]);
assert.notEqual(firstSnapshot[0].data.snapshot, secondSnapshot[0].data.snapshot);

// A failed read in one render must not prevent recovery in the following render.
let available = false;
globalThis.fetch = async () => available ? Response.json({ recovered: true }) : new Response(null, { status: 503 });
assert.deepEqual(await render(() => [requestServerJSON("/settings")]), [{ ok: false, status: 503 }]);
available = true;
assert.deepEqual(await render(() => [requestServerJSON("/settings")]), [{ ok: true, data: { recovered: true } }]);
console.log("Server read contracts passed");
