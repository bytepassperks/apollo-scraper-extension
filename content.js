(() => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inject.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
  let capture = null;
  let stopped = false;
  const pending = new Map();
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "apollo-lead-exporter") return;
    if (event.data.type === "capture") {
      try {
        capture = { ...event.data.capture, body: JSON.parse(event.data.capture.body) };
        chrome.runtime.sendMessage({ type: "capture", capture });
      } catch {}
    }
    if (event.data.type === "replay-result" && pending.has(event.data.runId)) {
      pending.get(event.data.runId)(event.data);
      pending.delete(event.data.runId);
    }
  });
  const replay = (body, runId) => new Promise(resolve => {
    pending.set(runId, resolve);
    window.postMessage({ source: "apollo-lead-exporter", type: "replay", runId, url: capture.url, headers: capture.headers, body }, "*");
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "get-capture") {
      sendResponse(capture ? { capture: { url: capture.url, method: capture.method, headers: capture.headers, body: capture.body }, resultCount: (capture.response?.people || capture.response?.contacts || []).length } : { capture: null });
      return true;
    }
    if (message.type === "run") {
      stopped = false;
      run(message.settings).then(result => sendResponse({ ok: true, ...result })).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === "stop") {
      stopped = true;
      chrome.runtime.sendMessage({ type: "run-status", status: { running: false, stopped: true } });
      sendResponse({ ok: true });
      return true;
    }
  });
  async function run(settings) {
    if (!capture) throw new Error("Run a search on Apollo first.");
    const seen = new Set();
    const records = [];
    const pagePath = findPagePath(capture.body);
    if (!pagePath) throw new Error("Could not find a page field in the captured request.");
    let page = Number(getPath(capture.body, pagePath)) || 1;
    const maxPages = Math.max(1, Number(settings.maxPages) || 100);
    const maxRecords = Math.max(1, Number(settings.maxRecords) || 1000);
    for (let count = 0; count < maxPages && records.length < maxRecords; count++, page++) {
      if (stopped) break;
      const response = await replay(setPath(capture.body, pagePath, page), `${Date.now()}-${count}`);
      if (response.error || response.status < 200 || response.status >= 300) throw new Error(response.error || `Apollo request failed (HTTP ${response.status}).`);
      const pageRecords = extract(response.body);
      if (!pageRecords.length) break;
      for (const record of pageRecords) {
        const id = record.id || record.contact_id || JSON.stringify(record);
        if (!seen.has(id)) { seen.add(id); records.push(record); }
        if (records.length >= maxRecords) break;
      }
      chrome.runtime.sendMessage({ type: "run-status", status: { running: true, pages: count + 1, records: records.length } });
      if (records.length < maxRecords) await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(settings.delayMs) || 1000) + Math.floor(Math.random() * 250)));
    }
    chrome.runtime.sendMessage({ type: "run-complete", records, format: settings.format, fields: settings.fields });
    return { records: records.length };
  }
  const extract = response => ["people", "contacts", "accounts", "organizations", "results"].flatMap(key => Array.isArray(response?.[key]) ? response[key] : Array.isArray(response?.data?.[key]) ? response.data[key] : []).filter((value, index, array) => array.indexOf(value) === index);
  const findPagePath = (value, path = []) => {
    if (!value || typeof value !== "object") return null;
    for (const key of ["page", "page_number", "pageNumber", "per_page", "page_size"]) if (key in value) return path.concat(key);
    for (const [key, child] of Object.entries(value)) { const found = findPagePath(child, path.concat(key)); if (found) return found; }
    return null;
  };
  const getPath = (value, path) => path.reduce((current, key) => current?.[key], value);
  const setPath = (value, path, next) => {
    const copy = structuredClone(value);
    let cursor = copy;
    for (let i = 0; i < path.length - 1; i++) cursor = cursor[path[i]];
    cursor[path.at(-1)] = next;
    return copy;
  };
})();
