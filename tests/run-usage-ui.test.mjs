import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateUsageMetrics, formatRecordedUsage, recordedMetricSummary, recordedUsagePeriod } from '../src/lib/run-usage.js';

const source = readFileSync(new URL('../src/components/RunUsage.jsx', import.meta.url), 'utf8');
const work = readFileSync(new URL('../src/views/Work.jsx', import.meta.url), 'utf8');
const roster = readFileSync(new URL('../src/views/AgentRoster.jsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/views/settings/SettingsCenter.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/run-usage.css', import.meta.url), 'utf8');

test('Missing and malformed usage values remain Unknown, while an explicitly recorded zero is zero', () => {
  for (const value of [null, undefined, '', '10', NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) assert.equal(formatRecordedUsage(value), 'Unknown');
  assert.equal(formatRecordedUsage(0), '0');
  assert.equal(formatRecordedUsage(1200), '1,200');
  assert.equal(formatRecordedUsage(null, 'usd'), 'Unknown');
  assert.equal(formatRecordedUsage(0, 'usd'), '$0.00');
  assert.equal(formatRecordedUsage(0.00001234, 'usd'), '$0.00001234');
  assert.equal(formatRecordedUsage(0.000000001, 'usd'), '< $0.00000001');
});

test('Usage period is explicit and stable, without inventing account reset or remaining limits', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');
  assert.deepEqual(recordedUsagePeriod('7', now), { from: '2026-09-17T12:00:00.000Z', to: now.toISOString() });
  assert.deepEqual(recordedUsagePeriod('all', now), {});
  assert.deepEqual(recordedUsagePeriod('invalid', now), {});
  assert.equal(now.toISOString(), '2026-09-24T12:00:00.000Z');
});

test('Known subtotals disclose missing and partial coverage without substituting zero for absent reports', () => {
  assert.equal(recordedMetricSummary({ known_subtotal: 0, reporting_run_count: 0 }).value, 'Unknown');
  assert.equal(recordedMetricSummary({ known_subtotal: 0, reporting_run_count: 1 }).value, '0');
  const summary = recordedMetricSummary({ known_subtotal: 1234, reporting_run_count: 3, unknown_eligible_run_count: 2, complete_report_run_count: 1, partial_run_count: 2 });
  assert.equal(summary.value, '1,234');
  assert.equal(summary.coverage, '3 reporting · 2 unknown eligible');
  assert.equal(summary.completeness, '1 complete reports · 2 partial reports');
  assert.equal(recordedMetricSummary({ known_subtotal: null, reporting_run_count: 1 }, 'usd').value, 'Unknown');
  assert.match(recordedMetricSummary({ known_subtotal: null, reporting_run_count: 2, subtotal_overflow: true }).note, /safe numeric range/);
});

test('Aggregate tables omit model count without combining main-loop and all-model metrics', () => {
  assert.deepEqual(aggregateUsageMetrics({ metrics: { input_tokens: { known_subtotal: 2 }, model_count: { known_subtotal: 9 } } }), [['input_tokens', { known_subtotal: 2 }]]);
  assert.match(source, /bucket.families \|\| \[\]\)\.map\(family/);
  assert.match(source, /claude.main_loop/); assert.match(source, /claude.all_models/);
  assert.match(source, /Do not add them to Claude all-model counters/);
  assert.match(source, /Reported model count/);
  assert.doesNotMatch(source, /reduce\(/);
});

test('Usage endpoints are read-only, abortable and invalidate stale scope results', () => {
  assert.match(source, /apiRequest\(path, \{ signal: controller.signal \}\)/);
  assert.match(source, /return \(\) => controller.abort\(\)/);
  assert.match(source, /state.key === key/);
  assert.match(source, /state.result\?\.run_id === run.id/);
  assert.match(source, /state.result\?\.scope\?\.workspace_id === workspaceId/);
  assert.doesNotMatch(source, /method:|startSession|\/authorize|\/connect|demoRequest|setInterval|window.confirm/);
});

test('Run and Agent Studio views fetch usage only after explicit opening', () => {
  assert.match(source, /\{open \? <RunUsageDialog/);
  assert.match(source, /\{open \? <div id=\{panelId\}><WorkspaceUsage/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(work, /const RunUsageButton = lazy/);
  assert.match(roster, /const AgentUsageDisclosure = lazy/);
  assert.match(settings, /const WorkspaceUsage = lazy/);
  assert.doesNotMatch(roster, /Usage and cost totals are not available here/);
});

test('Grouping and exact filters use canonical scoped endpoints and invocation start windows', () => {
  assert.match(source, /workspace_id: workspaceId, group_by: groupBy, \.\.\.period/);
  for (const key of ['agent_id', 'project_id', 'workflow_id']) assert.match(source, new RegExp(`query.set\\('${key}'`));
  assert.match(source, /const effectiveAgent = agentId \|\|/);
  assert.match(source, /<option value="workflow">Workflow/);
  assert.match(source, /inclusive to .* exclusive/);
  assert.match(source, /accessible_window_truncated/);
  assert.match(source, /these are not lifetime totals/);
  assert.match(source, /Hidden records and their counts are not disclosed/);
});

test('Cost estimates remain separate from billing, missing amounts and spend limits', () => {
  assert.match(source, /estimate\?\.total_cost_usd\?\.known === true/);
  assert.match(source, /recordedMetricSummary\(estimate, 'usd'\)/);
  assert.match(source, /Not billing or an invoice/);
  assert.match(source, /Codex cost remains unknown/);
  assert.match(source, /Estimate coverage concerns eligible Claude runs only/);
  assert.match(source, /account-wide remaining usage/);
  assert.match(settings, /Budget enforcement/);
  assert.match(settings, /Not active/);
  assert.doesNotMatch(source, /Math.round|known_subtotal \|\| 0|\.value \|\| 0/);
});

test('Absent estimates have no Claude label while recorded Claude estimates retain their provenance', () => {
  const estimateSource = transformSync(source.slice(source.indexOf('function UsageEstimate')), { loader: 'jsx', format: 'esm' }).code;
  const Estimate = runInNewContext(`${estimateSource}\nUsageEstimate;`, { React, recordedMetricSummary, formatRecordedUsage });
  const render = props => renderToStaticMarkup(React.createElement(Estimate, props));
  for (const aggregate of [false, true]) {
    for (const estimate of [null, undefined]) {
      const markup = render({ estimate, aggregate });
      assert.match(markup, /Cost unavailable/);
      assert.match(markup, /No provider-client estimate recorded\. Codex cost remains unknown\./);
      assert.doesNotMatch(markup, /Claude|<strong>Unknown/);
    }
  }
  const unknownRun = render({ estimate: { total_cost_usd: { value: null, known: false } } });
  assert.match(unknownRun, /Unknown/); assert.match(unknownRun, /recorded Claude client estimate/);
  const unknownSubtotal = render({ estimate: { known_subtotal: 0, reporting_run_count: 0 }, aggregate: true });
  assert.match(unknownSubtotal, /Unknown/); assert.match(unknownSubtotal, /known Claude client-estimate subtotal/);
  assert.match(render({ estimate: { total_cost_usd: { value: 0.25, known: true } } }), /\$0\.25/);
});

test('Usage surfaces compile and support mobile tables and keyboard scrolling', () => {
  for (const code of [source, work, roster, settings]) assert.doesNotThrow(() => transformSync(code, { loader: 'jsx', format: 'esm' }));
  const scroll = css.match(/\.dialog\s*>\s*\.run-usage-dialog\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(scroll, /min-height:\s*0/); assert.match(scroll, /overflow:\s*auto/);
  assert.match(css, /\.run-usage-table-scroll\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*auto/);
  assert.match(source, /tabIndex=\{0\} role="region" aria-label/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /flex:\s*1 1 100%; width:\s*100%/);
  assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|animation:/i);
});
