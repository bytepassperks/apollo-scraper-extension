(() => {
  const originalFetch = window.fetch;
  let active = true;
  const searchKeys = ["people", "contacts", "accounts", "organizations"];
  const looksLikeSearch = url => {
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname.startsWith("/api/");
    } catch { return false; }
  };
  const requestInfo = (input, init) => {
    const inputIsRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = inputIsRequest ? input.url : String(input);
    const method = String(init?.method || (inputIsRequest ? input.method : "GET")).toUpperCase();
    return { url, method, inputIsRequest };
  };
  const candidate = info => info.method === "POST" && looksLikeSearch(info.url);
  const headersFor = (input, init) => {
    try {
      const headers = typeof Request !== "undefined" && input instanceof Request ? input.headers : init?.headers;
      return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
    } catch { return {}; }
  };
  const bodyFor = (input, init, inputIsRequest) => {
    if (typeof init?.body === "string") return Promise.resolve(init.body);
    if (inputIsRequest) {
      try { return input.clone().text(); } catch { return Promise.resolve(""); }
    }
    if (init?.body instanceof URLSearchParams) return Promise.resolve(init.body.toString());
    return Promise.resolve("");
  };
  const hasRecords = body => {
    if (!body || typeof body !== "object") return false;
    const hasCollection = searchKeys.some(key => Array.isArray(body[key]) || Array.isArray(body.data?.[key]));
    return hasCollection || Array.isArray(body.results);
  };
  const hasSearchError = body => Boolean(body && typeof body === "object" && (body.error || body.errors || body.message || body.code));
  const isFinderRequest = request => {
    try {
      const pathname = new URL(request.url, location.href).pathname;
      if (/\/(?:mixed_)?(?:people|companies)\/search/.test(pathname)) return true;
      const body = JSON.parse(request.body || "{}");
      return Object.prototype.hasOwnProperty.call(body, "page") || Object.prototype.hasOwnProperty.call(body, "per_page") || Object.prototype.hasOwnProperty.call(body, "fields");
    } catch { return false; }
  };
  const remember = (request, response) => {
    if (!active || (!hasRecords(response) && (!hasSearchError(response) || !isFinderRequest(request)))) return;
    const capture = { ...request, response };
    window.postMessage({ source: "apollo-lead-exporter", type: "search-response", capture }, "*");
    if (hasRecords(response)) window.postMessage({ source: "apollo-lead-exporter", type: "capture", capture }, "*");
  };
  window.fetch = function(input, init) {
    if (!active) return originalFetch.apply(this, arguments);
    let info;
    try { info = requestInfo(input, init); } catch { return originalFetch.apply(this, arguments); }
    if (!candidate(info)) return originalFetch.apply(this, arguments);
    const bodyPromise = bodyFor(input, init, info.inputIsRequest);
    const responsePromise = originalFetch.apply(this, arguments);
    return responsePromise.then(response => bodyPromise.then(bodyText => {
      if (!bodyText) return response;
      return response.clone().json().then(responseBody => {
        remember({ url: info.url, method: info.method, headers: headersFor(input, init), body: bodyText, status: response.status }, responseBody);
        return response;
      }).catch(() => response);
    }).catch(() => response));
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__apolloRequest = { method: String(method).toUpperCase(), url: String(url), headers: {} };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__apolloRequest) {
      const existing = this.__apolloRequest.headers[name];
      this.__apolloRequest.headers[name] = existing ? `${existing}, ${value}` : String(value);
    }
    return setRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const request = this.__apolloRequest;
    if (active && request?.method === "POST" && looksLikeSearch(request.url)) {
      this.addEventListener("load", () => {
        try {
          const responseBody = JSON.parse(this.responseText);
            if (typeof body === "string") remember({ ...request, body, status: this.status }, responseBody);
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "apollo-lead-exporter") return;
    if (event.data.type === "context-invalid") {
      active = false;
      return;
    }
  });
})();
