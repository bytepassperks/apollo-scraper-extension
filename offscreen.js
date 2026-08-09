import { buildExportString } from "./lib/export.js";

const activeUrls = new Set();
const revoke = blobUrl => {
  if (!activeUrls.has(blobUrl)) return;
  URL.revokeObjectURL(blobUrl);
  activeUrls.delete(blobUrl);
  if (!activeUrls.size) window.close();
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "offscreen-revoke") {
    revoke(message.blobUrl);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type !== "offscreen-download") return false;
  const format = message.format === "json" ? "json" : "csv";
  const content = buildExportString(message.records || [], {
    format,
    fields: message.fields || [],
    allFields: Boolean(message.allFields),
    entityKind: message.entityKind || "people"
  });
  const blobUrl = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" }));
  const filename = `apollo-leads-${Date.now()}.${format}`;
  activeUrls.add(blobUrl);
  chrome.runtime.sendMessage({ type: "offscreen-ready", blobUrl, filename })
    .then(response => {
      if (!response?.ok) {
        revoke(blobUrl);
        sendResponse(response || { ok: false, error: "Download could not be started." });
        return;
      }
      sendResponse(response);
    })
    .catch(error => {
      revoke(blobUrl);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});
