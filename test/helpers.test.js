import test from "node:test";
import assert from "node:assert/strict";
import { flattenRecord, flattenAll } from "../lib/flatten.js";
import { toCsv } from "../lib/csv.js";
import { collectPages, extractRecords, refreshReplayBody, replayHeaders, requestError } from "../lib/pipeline.js";
import { buildExportString } from "../lib/export.js";
import { canDownload, progressText } from "../lib/popup-state.js";

test("flatten maps contact and organization fields", () => {
  const result = flattenRecord({ id: "c1", first_name: "Ada", organization: { name: "Acme", website_url: "https://acme.test" }, employment_history: [{ current: true, organization_name: "Acme", job_title: "CTO" }] });
  assert.equal(result.contact_id, "c1");
  assert.equal(result.organization_name, "Acme");
  assert.equal(result.organization_website_url, "https://acme.test");
  assert.equal(result.current_role, "CTO");
});

test("flattenAll preserves unknown nested fields", () => {
  assert.equal(flattenAll({ custom: { value: 2 }, tags: ["a", "b"] })["custom.value"], "2");
  assert.equal(flattenAll({ custom: { value: 2 }, tags: ["a", "b"] }).tags, '["a","b"]');
});

test("CSV uses BOM, RFC4180 escaping and selected fields", () => {
  const csv = toCsv([{ name: 'A "quoted"', email: "a@example.test" }], [{ label: "Name", key: "name" }, { label: "Email", key: "email" }]);
  assert.equal(csv, '\ufeffName,Email\r\n"A ""quoted""",a@example.test\r\n');
});

test("record extraction uses the first non-empty collection and results fallback", () => {
  assert.deepEqual(extractRecords({ people: [], contacts: [{ id: "c1" }], organizations: [{ id: "o1" }] }), [{ id: "c1" }]);
  assert.deepEqual(extractRecords({ data: { people: [], accounts: [{ id: "a1" }] } }), [{ id: "a1" }]);
  assert.deepEqual(extractRecords({ people: [], results: [{ id: "r1" }] }), [{ id: "r1" }]);
});

test("non-2xx replay errors include response details and 422 caps after records", async () => {
  assert.equal(requestError({ status: 422, body: { error: { message: "invalid search filter" } } }), "Apollo request failed (HTTP 422): invalid search filter.");
  await assert.rejects(
    () => collectPages({ requestBody: { page: 1 }, delayMs: 0, fetchPage: async () => ({ status: 422, body: { message: "bad request" } }) }),
    /HTTP 422\): bad request\./
  );
  const records = await collectPages({
    requestBody: { page: 1 }, delayMs: 0,
    fetchPage: async body => body.page === 1 ? { status: 200, body: { people: [{ id: "1" }] } } : { status: 422, body: { message: "page cap" } }
  });
  assert.deepEqual(records.map(record => record.id), ["1"]);
});

test("pagination never treats page-size fields as page cursors", async () => {
  await assert.rejects(
    () => collectPages({ requestBody: { per_page: 25 }, fetchPage: async () => ({ status: 200, body: { people: [] } }) }),
    /Could not find a page field/
  );
  const bodies = [];
  await collectPages({
    requestBody: { options: { per_page: 25 }, page: 1 }, maxPages: 2, delayMs: 0,
    fetchPage: async body => {
      bodies.push(body);
      return { status: 200, body: { people: [{ id: String(body.page) }] } };
    }
  });
  assert.deepEqual(bodies.map(body => [body.page, body.options.per_page]), [[1, 25], [2, 25]]);
});

test("replay drops one-shot headers and refreshes cache keys", () => {
  assert.deepEqual(
    replayHeaders({
      "x-csrf-token": "csrf",
      "x-cf-turnstile-response": "single-use",
      "X-CF-Widget-Type": "managed"
    }),
    { "x-csrf-token": "csrf" }
  );
  assert.deepEqual(refreshReplayBody({ page: 2, cacheKey: 123 }, 456), { page: 2, cacheKey: 456 });
  assert.deepEqual(refreshReplayBody({ page: 2 }, 456), { page: 2 });
});

test("export string and restored popup state are pure", () => {
  assert.match(buildExportString([{ id: "c1", first_name: "Ada" }], { format: "json", fields: ["contact_id", "first_name"] }), /"contact_id": "c1"/);
  assert.equal(progressText({ running: true, pages: 2, records: 8 }), "Pages fetched: 2 · Records collected: 8");
  assert.equal(progressText({ result: true, records: 8 }), "Complete · 8 records");
  assert.equal(canDownload({ records: 8 }), true);
  assert.equal(canDownload({ records: 0 }), false);
});

test("fixture pagination replays pages, dedupes ids, and stops on empty page", async () => {
  const calls = [];
  const records = await collectPages({
    requestBody: { filters: { page: 1 } }, delayMs: 0, jitter: 0, maxRecords: 10,
    fetchPage: async body => {
      calls.push(body.filters.page);
      return { status: 200, body: body.filters.page === 1 ? { contacts: [{ id: "1" }, { id: "2" }] } : body.filters.page === 2 ? { contacts: [{ id: "2" }, { id: "3" }] } : { contacts: [] } };
    }
  });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(records.map(item => item.id), ["1", "2", "3"]);
});
