import { flattenRecord, flattenAll, fieldDefinitions } from "./flatten.js";
import { toCsv } from "./csv.js";

export function buildExportString(records, { format = "csv", fields = [], allFields = false } = {}) {
  const selected = fields.length ? fields : fieldDefinitions().map(item => item[1]);
  const definitions = fieldDefinitions().filter(item => selected.includes(item[1])).map(item => ({ label: item[0], key: item[1] }));
  const rows = records.map(record => allFields ? { ...flattenRecord(record), ...flattenAll(record) } : flattenRecord(record));
  const exportDefinitions = allFields
    ? [...definitions, ...Object.keys(rows[0] || {}).filter(key => !definitions.some(field => field.key === key)).map(key => ({ label: key, key }))]
    : definitions;
  return format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows, exportDefinitions);
}
