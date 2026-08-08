(() => {
  const originalFetch = window.fetch.bind(window);
  let latest = null;
  const looksLikeSearch = url => {
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname.startsWith("/api/");
    } catch { return false; }
  };
  const hasRecords = body => {
    if (!body || typeof body !== "object") return false;
    const hasCollection = ["people", "contacts", "accounts", "organizations"].some(key => Array.isArray(body[key]) || Array.isArray(body.data?.[key]));
    return hasCollection && Boolean(body.pagination || body.page || body.meta?.pagination);
  };
  const remember = (request, response) => {
    if (!looksLikeSearch(request.url) || request.method !== "POST" || !hasRecords(response)) return;
    latest = { url: request.url, method: request.method, headers: request.headers || {}, body: request.body, response };
    window.postMessage({ source: "apollo-lead-exporter", type: "capture", capture: latest }, "*");
  };
  window.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const bodyText = request.method === "POST" ? await request.clone().text() : "";
    const response = await originalFetch(input, init);
    if (looksLikeSearch(request.url) && request.method === "POST") {
      try {
        const responseBody = await response.clone().json();
        remember({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers.entries()), body: bodyText }, responseBody);
      } catch {}
    }
    return response;
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__apolloRequest = { method, url };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const request = this.__apolloRequest;
    if (request?.method === "POST" && looksLikeSearch(request.url)) {
      this.addEventListener("load", () => {
        try {
          const responseBody = JSON.parse(this.responseText);
          remember({ ...request, headers: {}, body }, responseBody);
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };
  window.addEventListener("message", async event => {
    if (event.source !== window || event.data?.source !== "apollo-lead-exporter") return;
    if (event.data.type !== "replay") return;
    try {
      const response = await originalFetch(event.data.url, {
        method: "POST",
        headers: event.data.headers || { "Content-Type": "application/json" },
        body: JSON.stringify(event.data.body),
        credentials: "include"
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      window.postMessage({ source: "apollo-lead-exporter", type: "replay-result", runId: event.data.runId, status: response.status, body }, "*");
    } catch (error) {
      window.postMessage({ source: "apollo-lead-exporter", type: "replay-result", runId: event.data.runId, error: error.message }, "*");
    }
  });
})();
