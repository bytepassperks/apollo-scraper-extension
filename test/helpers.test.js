import test from "node:test";
import assert from "node:assert/strict";
import { flattenRecord, flattenAll } from "../lib/flatten.js";
import { toCsv } from "../lib/csv.js";
import { collectPages, extractRecords, requestError } from "../lib/pipeline.js";
import { buildExportString } from "../lib/export.js";
import { canDownload, progressText } from "../lib/popup-state.js";
import { chooseNextControl, ResponseGate, shouldStopAfterResponse, stableDomIdentity } from "../lib/ui-pagination.js";

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

test("record extraction stays within the expected entity kind", () => {
  assert.deepEqual(extractRecords({ people: [], contacts: [{ id: "c1" }], organizations: [{ id: "o1" }] }), [{ id: "c1" }]);
  assert.deepEqual(extractRecords({ people: [], contacts: [], accounts: [{ id: "a1" }] }, "people"), []);
  assert.deepEqual(extractRecords({ data: { accounts: [{ id: "a1" }] } }, "companies"), [{ id: "a1" }]);
  assert.deepEqual(extractRecords({ people: [], results: [{ id: "r1" }] }, "people"), []);
});

test("non-2xx replay errors include response details and 422 caps after records", async () => {
  assert.equal(requestError({ status: 422, body: { error: { message: "invalid search filter" } } }), "Apollo request failed (HTTP 422): invalid search filter.");
  assert.equal(requestError({ status: 422, body: { code: "upgrade_plan" } }), "Apollo request failed (HTTP 422): Apollo search limit reached for this plan — the run stopped.");
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

test("export string and restored popup state are pure", () => {
  assert.match(buildExportString([{ id: "c1", first_name: "Ada" }], { format: "json", fields: ["contact_id", "first_name"] }), /"contact_id": "c1"/);
  assert.equal(progressText({ running: true, page: 2, pages: 2, records: 8 }), "Page 2 · Pages fetched: 2 · Records collected: 8");
  assert.equal(progressText({ result: true, records: 8 }), "Complete · 8 records");
  assert.equal(canDownload({ records: 8 }), true);
  assert.equal(canDownload({ records: 0 }), false);
  assert.match(buildExportString([{ id: "a1", name: "Acme", linkedin_url: "https://linkedin.com/company/acme" }], { entityKind: "companies", fields: ["account_id", "name", "linkedin_url"] }), /Account ID,Company Name,LinkedIn URL/);
});

test("UI pagination chooses accessible next controls and stops at the last page", () => {
  const disabled = { ariaLabel: "Next page", disabled: true, visible: true };
  const next = { ariaLabel: "Next page", disabled: false, visible: true };
  assert.equal(chooseNextControl([disabled, next]), next);
  assert.equal(shouldStopAfterResponse({ control: null, newRecords: 2, page: 1, maxPages: 5, maxRecords: 10, records: 2 }), true);
  assert.equal(shouldStopAfterResponse({ control: next, newRecords: 0, page: 2, maxPages: 5, maxRecords: 10, records: 2 }), true);
  assert.equal(shouldStopAfterResponse({ control: next, newRecords: 2, page: 2, maxPages: 5, maxRecords: 10, records: 4, error: true }), true);
});

test("UI response gate handles click-response ordering and timeout", async () => {
  const gate = new ResponseGate();
  const response = gate.waitForNext(3, 50);
  gate.push({ status: 200 }, 3);
  let settled = false;
  setTimeout(() => gate.push({ status: 200, body: "next" }, 4), 0);
  assert.deepEqual(await response, { status: 200, body: "next" });
  await assert.rejects(() => new ResponseGate().waitForNext(1, 5), /Timed out waiting/);
});

test("stopping a UI wait cancels without turning into a timeout failure", async () => {
  const gate = new ResponseGate();
  const waiting = gate.waitForNext(1, 20000);
  gate.cancel();
  assert.deepEqual(await waiting, { cancelled: true });
  assert.equal(stableDomIdentity({ profileUrl: "https://app.apollo.io/person/1", name: "Ada", company: "Acme" }), "https://app.apollo.io/person/1");
  assert.equal(stableDomIdentity({ name: "Ada", company: "Acme" }), "Ada|Acme");
  assert.equal(stableDomIdentity({ name: "", company: "" }), "");
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
