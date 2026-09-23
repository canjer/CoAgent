// Response values are opt-in: unknown headers can carry session or application secrets.
const retained = new Set(['content-type','content-length','server','strict-transport-security','x-content-type-options','x-frame-options','cache-control','allow']);
export function auditHeaders(headers) {
 const result = {}; const redacted = []; const truncated = [];
 for (const [name, value] of Object.entries(headers)) {
  const key = name.toLowerCase();
  if (!retained.has(key)) { result[key] = '[REDACTED]'; redacted.push(key); continue; }
  const raw = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  result[key] = raw.slice(0, 1024); if (raw.length > 1024) truncated.push(key);
 }
 return {headers:result,redactedHeaders:redacted,truncatedHeaders:truncated};
}
export function auditRedirect(value) {
 // Preserve presence only: path, query and fragment can all contain credentials.
 return typeof value === 'string' ? {present:true,value:'[REDACTED]'} : {present:false};
}
