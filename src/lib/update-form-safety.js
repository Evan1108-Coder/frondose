// Used only for a boolean local readiness check. Values never leave the renderer.
export function updateFormFingerprint(form) {
  return JSON.stringify([...form.elements].filter(field => field.name || field.type).filter(field => !['submit', 'button', 'reset', 'hidden', 'search'].includes(field.type)).map(field => [field.name || field.id, field.type, ['checkbox', 'radio'].includes(field.type) ? field.checked : field.type === 'password' ? Boolean(field.value) : field.value]));
}
