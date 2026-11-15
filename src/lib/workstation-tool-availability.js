// These features have experimental implementations, but are not available in
// the release UI. Existing tab descriptors still use their original IDs.
export const DEFERRED_WORKSTATION_TOOLS = Object.freeze({
  computer: Object.freeze({ title: 'Computer Use', description: 'Operate a selected running application with your approval.' }),
  dictation: Object.freeze({ title: 'Dictation', description: 'Turn speech into text that you can review before inserting it.' }),
  devices: Object.freeze({ title: 'Mobile Emulator', description: 'Inspect mobile devices and simulators from your workspace.' }),
  environment: Object.freeze({ title: 'Development Environments', description: 'Run project commands in a dedicated development environment.' }),
});

export function isDeferredWorkstationTool(toolId) {
  return Object.hasOwn(DEFERRED_WORKSTATION_TOOLS, toolId);
}
