import { fieldDefinitions } from "./lib/flatten.js";
import { buildExportString } from "./lib/export.js";
import { canDownload, progressText } from "./lib/popup-state.js";
const $ = id => document.getElementById(id);
let tabId;
let definitions = [];
const defaults = { maxRecords: 1000, maxPages: 100, delayMs: 1000, format: "csv", fields: [] };
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  definitions = fieldDefinitions().map(([label, key]) => ({ label, key }));
  const settings = { ...defaults, ...(await chrome.storage.local.get(defaults)) };
  for (const id of ["max-records", "max-pages", "delay-ms"]) $(id).value = settings[id.replaceAll("-", "")] ?? settings[{ "max-records": "maxRecords", "max-pages": "maxPages", "delay-ms": "delayMs" }[id]];
  $("format").value = settings.format;
  $("all-fields").checked = settings.allFields || false;
  $("fields").innerHTML = definitions.map(field => `<label><input type="checkbox" data-key="${field.key}" ${!settings.fields.length || settings.fields.includes(field.key) ? "checked" : ""}> ${field.label}</label>`).join("");
  const capture = await chrome.tabs.sendMessage(tabId, { type: "get-capture" }).catch(() => ({ capture: null }));
  $("capture-status").textContent = capture.capture ? `Search captured: ${capture.resultCount || 0} results/page` : "Run a search on Apollo to arm the exporter.";
  const current = await chrome.runtime.sendMessage({ type: "get-state" });
  $("progress").textContent = progressText(current.state);
  $("download").disabled = !canDownload(current.state);
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === "run-status") $("progress").textContent = progressText(message.status);
    if (message.type === "run-complete") { $("download").disabled = canDownload({ records: message.records.length }) === false; $("progress").textContent = progressText({ result: true, records: message.records.length }); }
  });
}
const settings = () => ({ maxRecords: $("max-records").value, maxPages: $("max-pages").value, delayMs: $("delay-ms").value, format: $("format").value, allFields: $("all-fields").checked, fields: [...document.querySelectorAll("[data-key]:checked")].map(input => input.dataset.key) });
$("start").onclick = async () => { $("error").textContent = ""; const value = settings(); await chrome.storage.local.set(value); const response = await chrome.tabs.sendMessage(tabId, { type: "run", settings: value }); if (!response?.ok) $("error").textContent = response?.error || "Could not start export."; };
$("stop").onclick = () => chrome.tabs.sendMessage(tabId, { type: "stop" });
$("download").onclick = async () => {
  const value = settings();
  const response = await chrome.runtime.sendMessage({ type: "get-results" });
  const content = buildExportString(response.records || [], value);
  const blob = new Blob([content], { type: value.format === "json" ? "application/json" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const filename = `apollo-leads-${Date.now()}.${value.format === "json" ? "json" : "csv"}`;
  chrome.downloads.download({ url, filename, saveAs: true }, () => URL.revokeObjectURL(url));
};
$("all-fields").onchange = event => document.querySelectorAll("[data-key]").forEach(input => { input.checked = event.target.checked; });
init();
