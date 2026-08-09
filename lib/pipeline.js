export function findPath(value, keys, path = []) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(value, key)) return path.concat(key);
  for (const [key, child] of Object.entries(value)) {
    const found = findPath(child, keys, path.concat(key));
    if (found) return found;
  }
  return null;
}

export function atPath(value, path) {
  return path.reduce((current, key) => current == null ? undefined : current[key], value);
}

export function setPath(value, path, next) {
  const copy = structuredClone(value);
  let cursor = copy;
  for (let i = 0; i < path.length - 1; i++) cursor = cursor[path[i]];
  cursor[path[path.length - 1]] = next;
  return copy;
}

export function inferEntityKind(capture = {}, pageUrl = "") {
  const source = `${capture.url || ""} ${pageUrl}`.toLowerCase();
  return /mixed_compan|\/companies\b|\/accounts\b|\/organizations\b/.test(source) ? "companies" : "people";
}

export function extractRecords(response, entityKind = "people") {
  if (!response || typeof response !== "object") return [];
  const keys = entityKind === "companies" ? ["accounts", "organizations"] : ["people", "contacts"];
  return keys.flatMap(key => {
    if (Array.isArray(response[key])) return response[key];
    if (response.data && Array.isArray(response.data[key])) return response.data[key];
    return [];
  });
}

export function hasEntityCollection(response, entityKind = "people") {
  if (!response || typeof response !== "object") return false;
  const keys = entityKind === "companies" ? ["accounts", "organizations"] : ["people", "contacts"];
  return keys.some(key => Array.isArray(response[key]) || Array.isArray(response.data?.[key]));
}

export function paginationPath(body) {
  for (const key of ["page", "page_number", "pageNumber"]) {
    const cursor = findPath(body, [key]);
    if (cursor) return cursor;
  }
  return null;
}

export function responseErrorMessage(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (Array.isArray(body)) return body.map(responseErrorMessage).filter(Boolean).join("; ");
  if (typeof body !== "object") return String(body);
  if (body.code === "upgrade_plan") return "Apollo search limit reached for this plan — the run stopped.";
  for (const key of ["message", "error", "detail", "description", "raw"]) {
    if (body[key]) return responseErrorMessage(body[key]);
  }
  if (body.errors) return responseErrorMessage(body.errors);
  if (body.code) return String(body.code).replaceAll("_", " ");
  return "";
}

export function requestError(response) {
  const status = response?.status || "unknown";
  const detail = responseErrorMessage(response?.body);
  const suffix = detail ? `: ${detail}${detail.endsWith(".") ? "" : "."}` : ".";
  return `Apollo request failed (HTTP ${status})${suffix}`;
}

export async function collectPages({ requestBody, fetchPage, maxRecords = 1000, maxPages = 100, delayMs = 1000, jitter = 250, onProgress = () => {}, shouldStop = () => false }) {
  const pagePath = paginationPath(requestBody);
  if (!pagePath) throw new Error("Could not find a page field in the captured request.");
  const seen = new Set();
  const records = [];
  let page = Number(atPath(requestBody, pagePath)) || 1;
  for (let pages = 0; pages < maxPages && records.length < maxRecords; pages++, page++) {
    if (shouldStop()) break;
    const response = await fetchPage(setPath(requestBody, pagePath, page), page);
    if (!response || response.status < 200 || response.status >= 300) {
      if (response?.status === 422 && records.length) break;
      throw new Error(requestError(response));
    }
    const current = extractRecords(response.body);
    if (!current.length) break;
    for (const record of current) {
      const id = record.id || record.contact_id || record.contactId || JSON.stringify(record);
      if (!seen.has(id)) {
        seen.add(id);
        records.push(record);
        if (records.length >= maxRecords) break;
      }
    }
    onProgress({ pages: pages + 1, records: records.length });
    if (records.length >= maxRecords || current.length === 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, delayMs + Math.floor(Math.random() * (jitter + 1)) - Math.floor(jitter / 2))));
  }
  return records;
}
