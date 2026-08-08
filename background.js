import { flattenRecord, flattenAll, fieldDefinitions } from "./lib/flatten.js";
import { toCsv } from "./lib/csv.js";

let state = { running: false, pages: 0, records: 0, error: "", result: null };
let collected = [];
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture") {
    chrome.storage.local.set({ capture: message.capture });
    sendResponse({ ok: true });
  } else if (message.type === "run-status") {
    state = { ...state, ...message.status };
    sendResponse?.({ ok: true });
  } else if (message.type === "run-complete") {
    collected = message.records || [];
    state = { ...state, running: false, records: collected.length, result: true };
    sendResponse?.({ ok: true });
  } else if (message.type === "get-state") sendResponse({ state, fields: fieldDefinitions() });
  else if (message.type === "get-results") sendResponse({ records: collected });
  else if (message.type === "download") download(message.format, message.fields, message.allFields).then(() => sendResponse({ ok: true }));
  return true;
});
chrome.runtime.onConnect.addListener(port => {
  port.onDisconnect.addListener(() => {});
});
async function download(format, fields, allFields = false) {
  const selected = fields?.length ? fields : fieldDefinitions().map(item => item[1]);
  const definitions = fieldDefinitions().filter(item => selected.includes(item[1])).map(item => ({ label: item[0], key: item[1] }));
  const rows = collected.map(record => allFields ? { ...flattenRecord(record), ...flattenAll(record) } : flattenRecord(record));
  const exportDefinitions = allFields ? [...definitions, ...Object.keys(rows[0] || {}).filter(key => !definitions.some(field => field.key === key)).map(key => ({ label: key, key }))] : definitions;
  const content = format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows, exportDefinitions);
  const url = `data:${format === "json" ? "application/json" : "text/csv;charset=utf-8"},${encodeURIComponent(content)}`;
  await chrome.downloads.download({ url, filename: `apollo-leads-${Date.now()}.${format === "json" ? "json" : "csv"}`, saveAs: true });
}
