import { flattenRecord, flattenCompanyRecord, flattenAll, fieldDefinitions } from "./flatten.js";
import { toCsv } from "./csv.js";

export function buildExportString(records, { format = "csv", fields = [], allFields = false, entityKind = "people" } = {}) {
  const selected = fields.length ? fields : fieldDefinitions(entityKind).map(item => item[1]);
  const definitions = fieldDefinitions(entityKind).filter(item => selected.includes(item[1])).map(item => ({ label: item[0], key: item[1] }));
  const flatten = entityKind === "companies" ? flattenCompanyRecord : flattenRecord;
  const rows = records.map(record => allFields ? { ...flatten(record), ...flattenAll(record) } : flatten(record));
  const exportDefinitions = allFields
    ? [...definitions, ...Object.keys(rows[0] || {}).filter(key => !definitions.some(field => field.key === key)).map(key => ({ label: key, key }))]
    : definitions;
  return format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows, exportDefinitions);
}
