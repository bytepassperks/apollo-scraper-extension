import { fieldDefinitions } from "./lib/flatten.js";

let state = { running: false, pages: 0, records: 0, error: "", result: null };
let collected = [];
const stateReady = chrome.storage.local.get(["runState", "collectedRecords"]).then(saved => {
  state = { ...state, ...(saved.runState || {}) };
  collected = Array.isArray(saved.collectedRecords) ? saved.collectedRecords : [];
});
const activeDownloads = new Map();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture") {
    chrome.storage.local.set({ capture: message.capture });
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "run-status") {
    state = { ...state, ...message.status };
    persist();
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "run-start") {
    collected = [];
    state = { running: true, pages: 0, page: 1, records: 0, error: "", result: null };
    persist();
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "run-data") {
    collected = Array.isArray(message.records) ? message.records : collected;
    state = { ...state, ...message.status, records: collected.length };
    persist();
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "run-complete") {
    collected = message.records || [];
    state = { ...state, running: false, records: collected.length, result: true, entityKind: message.entityKind || state.entityKind || "people" };
    persist();
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "get-state") {
    stateReady.then(() => sendResponse({ state, fields: fieldDefinitions(state.entityKind) }));
    return true;
  } else if (message.type === "get-results") {
    stateReady.then(() => sendResponse({ records: collected }));
    return true;
  } else if (message.type === "download") {
    stateReady.then(() => ensureOffscreen()).then(() => chrome.runtime.sendMessage({
      type: "offscreen-download",
      records: collected,
      format: message.format,
      fields: message.fields,
      allFields: message.allFields,
      entityKind: state.entityKind || "people"
    })).then(response => sendResponse(response || { ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (message.type === "offscreen-ready") {
    chrome.downloads.download({ url: message.blobUrl, filename: message.filename, saveAs: true }, downloadId => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "Download could not be started." });
        return;
      }
      activeDownloads.set(downloadId, { blobUrl: message.blobUrl, timeout: setTimeout(() => finishDownload(downloadId), 10 * 60 * 1000) });
      sendResponse({ ok: true, downloadId });
    });
    return true;
  }
  return false;
});
chrome.downloads.onChanged.addListener(delta => {
  if (!activeDownloads.has(delta.id)) return;
  if (delta.state?.current === "complete" || delta.state?.current === "interrupted") finishDownload(delta.id);
});
chrome.runtime.onConnect.addListener(port => {
  port.onDisconnect.addListener(() => {});
});

function persist() {
  chrome.storage.local.set({ runState: state, collectedRecords: collected }).catch(error => console.error("[Apollo Lead Exporter] Could not persist run state", error));
}

function finishDownload(downloadId) {
  const entry = activeDownloads.get(downloadId);
  if (!entry) return;
  clearTimeout(entry.timeout);
  activeDownloads.delete(downloadId);
  chrome.runtime.sendMessage({ type: "offscreen-revoke", blobUrl: entry.blobUrl }).catch(() => {});
}

async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Create a Blob URL that remains available while an export download completes."
    });
  } catch (error) {
    if (!/only a single offscreen document/i.test(String(error.message))) throw error;
  }
}
