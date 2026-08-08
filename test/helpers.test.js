import test from "node:test";
import assert from "node:assert/strict";
import { flattenRecord, flattenAll } from "../lib/flatten.js";
import { toCsv } from "../lib/csv.js";
import { collectPages } from "../lib/pipeline.js";

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
