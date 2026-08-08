(() => {
  const pipelineReady = import(chrome.runtime.getURL("lib/pipeline.js"));
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
      run(message.settings)
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(error => {
          chrome.runtime.sendMessage({ type: "run-status", status: { running: false, error: error.message } });
          sendResponse({ ok: false, error: error.message });
        });
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
    const { collectPages } = await pipelineReady;
    const records = await collectPages({
      requestBody: capture.body,
      maxPages: Math.max(1, Number(settings.maxPages) || 100),
      maxRecords: Math.max(1, Number(settings.maxRecords) || 1000),
      delayMs: Math.max(0, Number(settings.delayMs) || 1000),
      fetchPage: (body, page) => replay(body, `${Date.now()}-${page}`),
      shouldStop: () => stopped,
      onProgress: progress => chrome.runtime.sendMessage({ type: "run-status", status: { running: true, ...progress } })
    });
    chrome.runtime.sendMessage({ type: "run-complete", records, format: settings.format, fields: settings.fields });
    return { records: records.length };
  }
})();
