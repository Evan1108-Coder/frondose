export function acceptanceStatusLabel(status) {
  return ({ passed: 'Pass', failed: 'Fail', missing: 'Missing', stale: 'Stale', unavailable: 'Unavailable' })[status] || 'Missing';
}

export function acceptanceRequestBody(payload, previous, makeId) {
  const key = JSON.stringify(payload);
  const request = previous?.key === key ? previous : { key, id: makeId() };
  return { request, body: { ...payload, request_id: request.id } };
}

export function acceptanceStateKey(output, agreement) {
  return JSON.stringify([output.id, output.version, output.current_version, output.task_id || null, agreement?.version ?? null]);
}

export function acceptanceApprovalReason({ result, loading, error }, output, version, agreement) {
  if (!version || version.number !== output.current_version) return 'Only the current output version can be approved.';
  if (output.archived_at) return 'Restore this output before reviewing it.';
  if (!output.task_id) return null;
  if (loading) return 'Checking the current acceptance policy and evidence…';
  if (error || !result) return 'Acceptance evidence is unavailable. Refresh evidence before approving.';
  if (result.output?.id !== output.id || result.output?.version !== output.version || result.output?.output_version_id !== version.id) return 'The output changed. Refresh evidence before approving.';
  if (result.policy?.policy_version !== 2) return null;
  const coverage = result.coverage;
  if (!coverage || coverage.output_version_id !== version.id || coverage.agreement_version !== agreement?.version) return 'The work agreement or output changed. Review current criteria and evidence again.';
  if (!coverage.total) return 'Add at least one acceptance criterion to the Route before approving.';
  const cases = Array.isArray(coverage.cases) ? coverage.cases : [];
  if (cases.length !== coverage.total || !coverage.complete || cases.some(item => item.status !== 'passed' || !item.assessment_id)) return 'Every current criterion needs a readable Pass assessment for this exact output version. Missing, failed or stale evidence blocks approval.';
  return null;
}

export function currentAcceptanceArtifacts(result) {
  return (result?.available_artifacts || []).filter(artifact => ['output_version', 'run_event'].includes(artifact.type) && artifact.id && typeof artifact.content === 'string');
}
