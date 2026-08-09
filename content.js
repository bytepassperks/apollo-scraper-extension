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
  const uiPaginationUrl = extensionUrl("lib/ui-pagination.js");
  if (!pipelineUrl || !injectUrl || !uiPaginationUrl) return;
  const pipelineReady = Promise.all([import(pipelineUrl), import(uiPaginationUrl)]).catch(error => {
    notifyContextInvalid();
    throw error;
  });
  const script = document.createElement("script");
  script.src = injectUrl;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
  let capture = null;
  let latestResponse = null;
  let responseSequence = 0;
  let responseGate = null;
  let stopped = false;
  pipelineReady.then(([, { ResponseGate }]) => { responseGate = new ResponseGate(); });
  const parseCapture = data => {
    let body = data.body;
    try { body = JSON.parse(body); } catch {}
    return { ...data, body };
  };
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "apollo-lead-exporter") return;
    if (event.data.type === "search-response") {
      latestResponse = parseCapture(event.data.capture);
      responseSequence++;
      responseGate?.push(latestResponse, responseSequence);
      const hasRecords = Array.isArray(latestResponse.response?.people) || Array.isArray(latestResponse.response?.contacts) || Array.isArray(latestResponse.response?.accounts) || Array.isArray(latestResponse.response?.organizations) || Array.isArray(latestResponse.response?.results);
      if (hasRecords) {
        capture = latestResponse;
        safeSend({ type: "capture", capture });
      }
    } else if (event.data.type === "capture" && !latestResponse) {
      capture = parseCapture(event.data.capture);
      latestResponse = capture;
      responseSequence++;
      safeSend({ type: "capture", capture });
    }
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
    const [{ extractRecords, requestError, responseErrorMessage }, { chooseNextControl, ResponseGate }] = await pipelineReady;
    if (!responseGate) responseGate = new ResponseGate();
    if (!latestResponse) throw new Error("Run a search on Apollo first.");
    const maxPages = Math.max(1, Number(settings.maxPages) || 100);
    const maxRecords = Math.max(1, Number(settings.maxRecords) || 1000);
    const delayMs = Math.max(0, Number(settings.delayMs) || 2500);
    const records = [];
    const seen = new Set();
    const addRecords = current => {
      let added = 0;
      for (const record of current) {
        const id = record.id || record.contact_id || record.contactId || JSON.stringify(record);
        if (seen.has(id)) continue;
        seen.add(id);
        records.push(record);
        added++;
        if (records.length >= maxRecords) break;
      }
      return added;
    };
    const initialError = latestResponse.status < 200 || latestResponse.status >= 300 || responseErrorMessage(latestResponse.response);
    if (initialError) throw new Error(requestError({ status: latestResponse.status, body: latestResponse.response }));
    let page = Number(capture.body?.page || capture.body?.page_number || capture.body?.pageNumber) || 1;
    let pages = 1;
    addRecords(extractRecords(latestResponse.response));
    safeSend({ type: "run-status", status: { running: true, page, pages, records: records.length } });
    const visibleControl = () => {
      const elements = [...document.querySelectorAll("button, a, [role='button']")].map(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          element,
          ariaLabel: element.getAttribute("aria-label") || "",
          title: element.getAttribute("title") || "",
          text: element.innerText?.trim() || "",
          disabled: Boolean(element.disabled),
          ariaDisabled: element.getAttribute("aria-disabled") || "",
          visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
        };
      });
      return chooseNextControl(elements)?.element || null;
    };
    while (!stopped && pages < maxPages && records.length < maxRecords) {
      const control = visibleControl();
      if (!control) break;
      const sequence = responseSequence;
      const nextResponse = responseGate.waitForNext(sequence);
      control.click();
      const response = await nextResponse;
      if (stopped || response.cancelled) break;
      if (response.status < 200 || response.status >= 300 || responseErrorMessage(response.response)) {
        throw new Error(requestError({ status: response.status, body: response.response }));
      }
      page++;
      pages++;
      const added = addRecords(extractRecords(response.response));
      safeSend({ type: "run-status", status: { running: true, page, pages, records: records.length } });
      if (!added) break;
      if (pages >= maxPages || records.length >= maxRecords) break;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, delayMs + Math.floor(Math.random() * 501) - 250)));
    }
    safeSend({ type: "run-complete", records, format: settings.format, fields: settings.fields });
    return { records: records.length };
  }
})();
