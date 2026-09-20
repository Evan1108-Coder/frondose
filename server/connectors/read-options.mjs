import { providerError } from './adapters.mjs';
import { CONNECTOR_CATALOG } from './catalog.mjs';

export function connectionReadOptions(provider, input = {}, kind) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw providerError('invalid_read_options', 'Read options must be an object.');
  const fields = CONNECTOR_CATALOG[provider]?.read_fields || [];
  const allowed = [...new Set([...(provider === 'google-sheets' ? ['range'] : provider === 'github-packages' ? ['package_type'] : []), ...fields.map(field => field.name)])];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw providerError('invalid_read_options', 'These read options do not apply to this provider.');
  const options = {};
  for (const field of fields) {
    const value = input[field.name];
    if (value !== undefined && (typeof value !== 'string' || value.length > 1000 || /[\x00-\x1f]/.test(value))) throw providerError('invalid_read_options', `${field.label} must be bounded text.`);
    if (kind && field.required && (!field.kind || field.kind === kind) && !value?.trim()) throw providerError('invalid_read_options', `${field.label} is required for this content type.`);
    if (value?.trim()) options[field.name] = value.trim();
  }
  if (provider === 'google-sheets') {
    const range = input.range ?? 'A1:Z200';
    // A bounded rectangle prevents a whole-column selection from silently caching a workbook.
    const match = typeof range === 'string' && range.match(/^(?:(?:'[^'\r\n]{1,100}'|[A-Za-z0-9_ -]{1,100})!)?([A-Za-z]{1,3})([1-9]\d{0,6}):([A-Za-z]{1,3})([1-9]\d{0,6})$/);
    const column = letters => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    if (!match || range.length > 180) throw providerError('invalid_read_options', 'Use a bounded range such as Sheet1!A1:Z200.');
    const width = column(match[3]) - column(match[1]) + 1, height = Number(match[4]) - Number(match[2]) + 1;
    if (width < 1 || height < 1 || width * height > 20000) throw providerError('invalid_read_options', 'Choose an ordered range of at most 20,000 cells.');
    return { ...options, range };
  }
  if (provider === 'github-packages') {
    const package_type = input.package_type ?? 'container';
    if (!['container', 'npm', 'maven', 'rubygems', 'docker', 'nuget'].includes(package_type)) throw providerError('invalid_read_options', 'Choose a supported package ecosystem.');
    return { ...options, package_type };
  }
  return options;
}

export function effectiveReadOptions(provider, saved = {}, input = {}, kind) {
  const fields = ['range', 'package_type', ...(CONNECTOR_CATALOG[provider]?.read_fields || []).map(field => field.name)];
  return connectionReadOptions(provider, { ...saved, ...Object.fromEntries(fields.filter(field => input[field] !== undefined).map(field => [field, input[field]])) }, kind);
}
