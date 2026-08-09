(() => {
  const contextError = "Extension context expired. Reload the Apollo tab.";
  let contextNotified = false;
  const contextValid = () => Boolean(globalThis.chrome?.runtime?.id);
  const notifyContextInvalid = () => {
    if (contextNotified) return;
    contextNotified = true;
    window.postMessage({ source: "apollo-lead-exporter", type: "context-invalid" }, "*");
  };
  const extensionUrl = path => {
    if (!contextValid()) {
      notifyContextInvalid();
      return null;
    }
    try { return chrome.runtime.getURL(path); } catch { notifyContextInvalid(); return null; }
  };
  const safeSend = message => {
    if (!contextValid()) {
      notifyContextInvalid();
      return Promise.resolve(undefined);
    }
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message)).catch(error => {
        if (!contextValid() || /invalid|context|receiving end/i.test(error.message || "")) notifyContextInvalid();
        return undefined;
      });
    } catch {
      notifyContextInvalid();
      return Promise.resolve(undefined);
    }
  };
  const pipelineUrl = extensionUrl("lib/pipeline.js");
  const injectUrl = extensionUrl("inject.js");
  if (!pipelineUrl || !injectUrl) return;
  const pipelineReady = import(pipelineUrl).catch(error => {
    notifyContextInvalid();
    throw error;
  });
  const script = document.createElement("script");
  script.src = injectUrl;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
  let capture = null;
  let stopped = false;
  const pending = new Map();
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "apollo-lead-exporter") return;
    if (event.data.type === "capture") {
      try {
        let body = event.data.capture.body;
        try { body = JSON.parse(body); } catch {}
        capture = { ...event.data.capture, body };
        safeSend({ type: "capture", capture });
      } catch {}
    }
    if (event.data.type === "replay-result" && pending.has(event.data.runId)) {
      pending.get(event.data.runId)(event.data);
      pending.delete(event.data.runId);
    }
  });
  const replay = (body, runId, headers) => new Promise((resolve, reject) => {
    if (!contextValid()) {
      notifyContextInvalid();
      reject(new Error(contextError));
      return;
    }
    pending.set(runId, resolve);
    window.postMessage({ source: "apollo-lead-exporter", type: "replay", runId, url: capture.url, headers, body }, "*");
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "get-capture") {
      sendResponse(capture ? { capture: { url: capture.url, method: capture.method, headers: capture.headers, body: capture.body }, resultCount: (capture.response?.people || capture.response?.contacts || []).length } : { capture: null });
      return false;
    }
    if (message.type === "run") {
      stopped = false;
      run(message.settings)
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(error => {
          safeSend({ type: "run-status", status: { running: false, error: error.message } });
          sendResponse({ ok: false, error: error.message });
        });
      return true;
    }
    if (message.type === "stop") {
      stopped = true;
      safeSend({ type: "run-status", status: { running: false, stopped: true } });
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
  async function run(settings) {
    if (!contextValid()) {
      notifyContextInvalid();
      throw new Error(contextError);
    }
    if (!capture) throw new Error("Run a search on Apollo first.");
    const { collectPages, refreshReplayBody, replayHeaders } = await pipelineReady;
    const records = await collectPages({
      requestBody: capture.body,
      maxPages: Math.max(1, Number(settings.maxPages) || 100),
      maxRecords: Math.max(1, Number(settings.maxRecords) || 1000),
      delayMs: Math.max(0, Number(settings.delayMs) || 1000),
      fetchPage: (body, page) => {
        if (!contextValid()) {
          notifyContextInvalid();
          return Promise.reject(new Error(contextError));
        }
        const replayBody = refreshReplayBody(body);
        console.debug("[Apollo Lead Exporter] replay", { url: capture.url, page, body: replayBody });
        return replay(replayBody, `${Date.now()}-${page}`, replayHeaders(capture.headers)).then(response => {
          if (response.error || response.status < 200 || response.status >= 300) {
            console.error("[Apollo Lead Exporter] replay failed", {
              url: capture.url,
              headers: Object.keys(capture.headers || {}),
              body: replayBody,
              response: response.body || response.error
            });
          }
          return response;
        });
      },
      shouldStop: () => stopped,
      onProgress: progress => safeSend({ type: "run-status", status: { running: true, ...progress } })
    });
    safeSend({ type: "run-complete", records, format: settings.format, fields: settings.fields });
    return { records: records.length };
  }
})();
