import { fieldDefinitions } from "./lib/flatten.js";

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
  return true;
});
chrome.runtime.onConnect.addListener(port => {
  port.onDisconnect.addListener(() => {});
});
