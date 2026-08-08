import { buildExportString } from "./lib/export.js";

const activeDownloads = new Map();
const revoke = downloadId => {
  const entry = activeDownloads.get(downloadId);
  if (!entry) return;
  clearTimeout(entry.timeout);
  URL.revokeObjectURL(entry.url);
  activeDownloads.delete(downloadId);
  if (!activeDownloads.size) chrome.offscreen.closeDocument().catch(() => {});
};

chrome.downloads.onChanged.addListener(delta => {
  if (!activeDownloads.has(delta.id)) return;
  if (delta.state?.current === "complete" || delta.state?.current === "interrupted") revoke(delta.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "offscreen-download") return;
  const format = message.format === "json" ? "json" : "csv";
  const content = buildExportString(message.records || [], {
    format,
    fields: message.fields || [],
    allFields: Boolean(message.allFields)
  });
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const filename = `apollo-leads-${Date.now()}.${format}`;
  chrome.downloads.download({ url, filename, saveAs: true }, downloadId => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      URL.revokeObjectURL(url);
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "Download could not be started." });
      chrome.offscreen.closeDocument().catch(() => {});
      return;
    }
    const timeout = setTimeout(() => revoke(downloadId), 10 * 60 * 1000);
    activeDownloads.set(downloadId, { url, timeout });
    sendResponse({ ok: true, downloadId });
  });
  return true;
});
