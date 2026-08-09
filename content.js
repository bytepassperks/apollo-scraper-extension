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
  pipelineReady.then(([, { ResponseGate }]) => { responseGate = new ResponseGate(); }).catch(() => {});
  const parseCapture = data => {
    let body = data.body;
    try { body = JSON.parse(body); } catch {}
    return { ...data, body };
  };
  const captureKind = data => /mixed_compan|\/companies\b|\/accounts\b|\/organizations\b/i.test(data?.url || "") ? "companies" : "people";
  const errorText = error => {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    try {
      const serialized = JSON.stringify(error);
      return serialized && serialized !== "{}" ? serialized : "Apollo export failed.";
    } catch {
      return "Apollo export failed.";
    }
  };
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "apollo-lead-exporter") return;
    if (event.data.type === "search-response") {
      latestResponse = { ...parseCapture(event.data.capture), entityKind: captureKind(event.data.capture) };
      responseSequence++;
      responseGate?.push(latestResponse, responseSequence);
      const hasRecords = Array.isArray(latestResponse.response?.people) || Array.isArray(latestResponse.response?.contacts) || Array.isArray(latestResponse.response?.accounts) || Array.isArray(latestResponse.response?.organizations) || Array.isArray(latestResponse.response?.results);
      if (hasRecords) {
        capture = latestResponse;
        safeSend({ type: "capture", capture });
      }
    } else if (event.data.type === "capture" && !latestResponse) {
      capture = { ...parseCapture(event.data.capture), entityKind: captureKind(event.data.capture) };
      latestResponse = capture;
      responseSequence++;
      safeSend({ type: "capture", capture });
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "get-capture") {
      sendResponse(capture ? { capture: { url: capture.url, method: capture.method, headers: capture.headers, body: capture.body, entityKind: capture.entityKind }, entityKind: capture.entityKind, resultCount: (capture.response?.people || capture.response?.contacts || capture.response?.accounts || capture.response?.organizations || []).length } : { capture: null });
      return false;
    }
    if (message.type === "run") {
      stopped = false;
      run(message.settings)
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(error => {
          if (stopped) {
            safeSend({ type: "run-status", status: { running: false, stopped: true } });
            sendResponse({ ok: true, stopped: true });
          } else {
            const message = errorText(error);
            safeSend({ type: "run-status", status: { running: false, error: message } });
            sendResponse({ ok: false, error: message });
          }
        });
      return true;
    }
    if (message.type === "stop") {
      stopped = true;
      responseGate?.cancel();
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
    const [{ extractRecords, hasEntityCollection, inferEntityKind, requestError, responseErrorMessage }, { chooseNextControl, stableDomIdentity, ResponseGate }] = await pipelineReady;
    if (!responseGate) responseGate = new ResponseGate();
    if (!latestResponse) throw new Error("Run a search on Apollo first.");
    const entityKind = inferEntityKind(capture || latestResponse, location.href);
    const initialError = latestResponse.status < 200 || latestResponse.status >= 300 || responseErrorMessage(latestResponse.response);
    if (initialError) throw new Error(requestError({ status: latestResponse.status, body: latestResponse.response }));
    if (!capture) throw new Error("Run a search on Apollo first.");
    const maxPages = Math.max(1, Number(settings.maxPages) || 100);
    const maxRecords = Math.max(1, Number(settings.maxRecords) || 1000);
    const delayMs = Math.max(0, Number(settings.delayMs) || 2500);
    const records = [];
    const seen = new Set();
    await safeSend({ type: "run-start" });
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
    const domFallbackRecords = () => [...document.querySelectorAll('[role="row"], tr')]
      .filter(row => row.querySelector('input[type="checkbox"], [aria-colindex="1"] a, [aria-colindex="1"]'))
      .map(row => {
        const nameNode = row.querySelector('[aria-colindex="1"] a, [aria-colindex="1"]');
        const titleNode = row.querySelector('[aria-colindex="2"]');
        const companyNode = row.querySelector('[aria-colindex="3"]');
        const locationNode = row.querySelector('[aria-colindex="4"]');
        const text = row.innerText || "";
        const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
        const name = nameNode?.innerText?.trim() || "";
        const profileUrl = nameNode?.href || "";
        const company = companyNode?.innerText?.trim() || "";
        const id = stableDomIdentity({ profileUrl, name, company });
        if (!id) return null;
        return {
          id,
          full_name: name,
          organization_name: company,
          job_title: titleNode?.innerText?.trim() || "",
          city: locationNode?.innerText?.trim() || "",
          email: emails[0] || "",
          linkedin_url: profileUrl
        };
      });
    const recordsFrom = response => {
      const current = extractRecords(response, entityKind);
      return current.length || hasEntityCollection(response, entityKind) ? current : domFallbackRecords();
    };
    let page = Number(capture.body?.page || capture.body?.page_number || capture.body?.pageNumber) || 1;
    let pages = 1;
    addRecords(recordsFrom(latestResponse.response));
    const status = () => ({ running: true, page, pages, records: records.length });
    safeSend({ type: "run-data", records, status: { ...status(), entityKind } });
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
      const added = addRecords(recordsFrom(response.response));
      safeSend({ type: "run-data", records, status: { ...status(), entityKind } });
      if (!added) break;
      if (pages >= maxPages || records.length >= maxRecords) break;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, delayMs + Math.floor(Math.random() * 501) - 250)));
    }
    if (stopped) {
      safeSend({ type: "run-status", status: { running: false, stopped: true, records: records.length } });
      return { records: records.length, stopped: true };
    }
    safeSend({ type: "run-complete", records, format: settings.format, fields: settings.fields, entityKind });
    return { records: records.length };
  }
})();
