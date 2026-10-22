import { getRunnerProvider, RUNNER_PROVIDER_CATALOG } from './runner-provider-catalog.js';

export const EMPTY_RUNNER_POLICY = Object.freeze({ enabled: false, provider_ids: Object.freeze([]), project_ids: Object.freeze([]), max_concurrent_sessions: 1, allow_workspace_members: false, native_tools_approved: false, package_execution_approved: false });

export function normalizeRunnerPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Computer execution policy must be an object.');
  const result = { ...EMPTY_RUNNER_POLICY, ...value };
  for (const key of Object.keys(value)) if (!Object.hasOwn(EMPTY_RUNNER_POLICY, key)) throw new Error('Unsupported computer execution policy field.');
  for (const key of ['enabled', 'allow_workspace_members', 'native_tools_approved', 'package_execution_approved']) if (typeof result[key] !== 'boolean') throw new Error('Computer execution consent must be explicit.');
  if (!Number.isSafeInteger(result.max_concurrent_sessions) || result.max_concurrent_sessions < 1 || result.max_concurrent_sessions > 8) throw new Error('Allow between one and eight computer sessions.');
  if (!Array.isArray(result.provider_ids) || result.provider_ids.length > RUNNER_PROVIDER_CATALOG.length || result.provider_ids.some(id => !getRunnerProvider(id))) throw new Error('Choose runtime IDs from the computer catalog.');
  if (!Array.isArray(result.project_ids) || result.project_ids.length > 100 || result.project_ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id))) throw new Error('Choose valid mapped project IDs.');
  result.provider_ids = [...new Set(result.provider_ids)].sort();
  result.project_ids = [...new Set(result.project_ids)].sort();
  if (result.enabled && !result.provider_ids.length) throw new Error('Authorize at least one runtime before enabling computer execution.');
  return result;
}

// These two adapters can explicitly disable their native tools. Other runtimes
// are trusted OS-user execution, never a claimed read-only sandbox.
export const runnerRequiresNativeTools = id => Boolean(getRunnerProvider(id)) && !['codex', 'claude'].includes(id);
