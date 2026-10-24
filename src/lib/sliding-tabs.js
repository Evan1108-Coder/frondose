// Filters use a radio group: one selected value, one Tab stop, arrow selection.
export function nextSlidingTab(options, current, key, direction = 'ltr') {
  const enabled = options.filter(option => !option.disabled);
  if (!enabled.length) return null;
  if (key === 'Home') return enabled[0].value;
  if (key === 'End') return enabled.at(-1).value;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return null;
  const forward = key === 'ArrowDown' || key === (direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
  const index = enabled.findIndex(option => option.value === current);
  return enabled[(index + (forward ? 1 : -1) + enabled.length) % enabled.length].value;
}
