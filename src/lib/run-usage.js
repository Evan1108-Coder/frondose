export function formatRecordedUsage(value, unit = 'tokens') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Unknown';
  if (unit === 'usd') return value > 0 && value < 0.00000001 ? '< $0.00000001' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8, minimumFractionDigits: 2 }).format(value);
  if (!Number.isSafeInteger(value)) return 'Unknown';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function recordedUsagePeriod(days, now = new Date()) {
  if (days === 'all') return {};
  const count = Number(days);
  if (![7, 30, 90].includes(count)) return {};
  const until = new Date(now), since = new Date(now);
  since.setUTCDate(since.getUTCDate() - count);
  return { from: since.toISOString(), to: until.toISOString() };
}

export function recordedMetricSummary(metric, unit = 'tokens') {
  const reporting = metric?.reporting_run_count;
  return {
    value: Number.isSafeInteger(reporting) && reporting > 0 ? formatRecordedUsage(metric?.known_subtotal, unit) : 'Unknown',
    coverage: `${formatRecordedUsage(reporting)} reporting · ${formatRecordedUsage(metric?.unknown_eligible_run_count)} unknown eligible`,
    completeness: `${formatRecordedUsage(metric?.complete_report_run_count)} complete reports · ${formatRecordedUsage(metric?.partial_run_count)} partial reports`,
    note: metric?.subtotal_overflow ? 'Subtotal exceeds the safe numeric range and is unavailable.' : '',
  };
}

export function aggregateUsageMetrics(family) {
  return Object.entries(family?.metrics || {}).filter(([key]) => key !== 'model_count');
}
