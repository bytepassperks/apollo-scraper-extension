import { fieldDefinitions } from "./lib/flatten.js";

let state = { running: false, pages: 0, records: 0, error: "", result: null };
let collected = [];
const activeDownloads = new Map();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture") {
    chrome.storage.local.set({ capture: message.capture });
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "run-status") {
    state = { ...state, ...message.status };
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "run-complete") {
    collected = message.records || [];
    state = { ...state, running: false, records: collected.length, result: true };
    sendResponse({ ok: true });
    return false;
  } else if (message.type === "get-state") {
    sendResponse({ state, fields: fieldDefinitions() });
    return false;
  } else if (message.type === "get-results") {
    sendResponse({ records: collected });
    return false;
  } else if (message.type === "download") {
    ensureOffscreen().then(() => chrome.runtime.sendMessage({
      type: "offscreen-download",
      records: collected,
      format: message.format,
      fields: message.fields,
      allFields: message.allFields
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
