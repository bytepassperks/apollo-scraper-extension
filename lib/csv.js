export function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, fields) {
  const headers = fields.map(field => typeof field === "string" ? field : field.label);
  const keys = fields.map(field => typeof field === "string" ? field : field.key);
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) lines.push(keys.map(key => escapeCsv(row[key])).join(","));
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
