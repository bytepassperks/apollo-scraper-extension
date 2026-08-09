import { fieldDefinitions } from "./lib/flatten.js";
import { canDownload, progressText } from "./lib/popup-state.js";
const $ = id => document.getElementById(id);
let tabId;
let definitions = [];
const defaults = { maxRecords: 1000, maxPages: 100, delayMs: 2500, format: "csv", fields: [] };
const contextError = "Extension context expired. Reload the Apollo tab.";
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  const settings = { ...defaults, ...(await chrome.storage.local.get(defaults)) };
  for (const id of ["max-records", "max-pages", "delay-ms"]) $(id).value = settings[id.replaceAll("-", "")] ?? settings[{ "max-records": "maxRecords", "max-pages": "maxPages", "delay-ms": "delayMs" }[id]];
  $("format").value = settings.format;
  $("all-fields").checked = settings.allFields || false;
  const capture = await chrome.tabs.sendMessage(tabId, { type: "get-capture" }).catch(error => ({ capture: null, contextInvalid: /context|receiving end|invalid/i.test(error.message || "") }));
  definitions = fieldDefinitions(capture.entityKind || "people").map(([label, key]) => ({ label, key }));
  const validFields = new Set(definitions.map(field => field.key));
  const selectedFields = settings.fields.filter(key => validFields.has(key));
  $("fields").innerHTML = definitions.map(field => `<label><input type="checkbox" data-key="${field.key}" ${!selectedFields.length || selectedFields.includes(field.key) ? "checked" : ""}> ${field.label}</label>`).join("");
  $("capture-status").textContent = capture.contextInvalid ? contextError : capture.capture ? `Search captured: ${capture.resultCount || 0} results/page. Start pages through the Apollo results UI.` : "Run a search on Apollo to arm the exporter.";
  const current = await chrome.runtime.sendMessage({ type: "get-state" });
  $("progress").textContent = progressText(current.state);
  $("download").disabled = !canDownload(current.state);
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === "run-status") $("progress").textContent = progressText(message.status);
    if (message.type === "run-complete") { $("download").disabled = canDownload({ records: message.records.length }) === false; $("progress").textContent = progressText({ result: true, records: message.records.length }); }
  });
}
const settings = () => ({ maxRecords: $("max-records").value, maxPages: $("max-pages").value, delayMs: $("delay-ms").value, format: $("format").value, allFields: $("all-fields").checked, fields: [...document.querySelectorAll("[data-key]:checked")].map(input => input.dataset.key) });
$("start").onclick = async () => {
  $("error").textContent = "";
  const value = settings();
  await chrome.storage.local.set(value);
  const response = await chrome.tabs.sendMessage(tabId, { type: "run", settings: value }).catch(error => ({ ok: false, error: /context|receiving end|invalid/i.test(error.message || "") ? contextError : error.message }));
  if (!response?.ok) $("error").textContent = response?.error || "Could not start export.";
};
$("stop").onclick = () => chrome.tabs.sendMessage(tabId, { type: "stop" });
$("download").onclick = async () => {
  const value = settings();
  const response = await chrome.runtime.sendMessage({ type: "download", format: value.format, fields: value.fields, allFields: value.allFields });
  if (!response?.ok) $("error").textContent = response?.error || "Could not start download.";
};
$("all-fields").onchange = event => document.querySelectorAll("[data-key]").forEach(input => { input.checked = event.target.checked; });
init();
