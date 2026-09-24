export function contextRequestKey(request) {
  return JSON.stringify(request ?? null);
}

export function validContextInspection(value) {
  return !!value && typeof value.id === 'string' && value.id.length > 0 && value.manifest != null && typeof value.manifest === 'object' && !Array.isArray(value.manifest) && typeof value.finalPrompt === 'string' && Number.isFinite(Date.parse(value.expires_at));
}

export function contextInspectionState(inspection, capturedKey, currentKey, now = Date.now()) {
  if (!inspection) return { stale: false, expired: false, usable: false };
  const stale = capturedKey !== currentKey;
  const expired = !validContextInspection(inspection) || Date.parse(inspection.expires_at) <= now;
  return { stale, expired, usable: !stale && !expired };
}

const count = value => Number.isInteger(value) && value >= 0 ? value : null;

export function contextSizeFacts(manifest = {}) {
  const counts = manifest.counts ?? {};
  const included = Array.isArray(manifest.included) ? manifest.included : [];
  const excluded = Array.isArray(manifest.excluded) ? manifest.excluded : [];
  return {
    exactCharacters: counts.character_count_exact === true ? count(counts.total_characters) : null,
    characterUnit: counts.character_unit || 'UTF-16 code units',
    utf8Bytes: count(counts.utf8_bytes),
    included: included.length,
    excluded: excluded.length,
    truncated: included.filter(source => source.status === 'truncated').length,
  };
}
