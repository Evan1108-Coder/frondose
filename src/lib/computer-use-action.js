export const COMPUTER_USE_ACTIONS = Object.freeze(['snapshot','press','set-value','scroll','screenshot']);
export const COMPUTER_USE_TOOL = Object.freeze({ name:'frondose_computer',description:'Request a human-reviewed action on the application the user selected in Frondose. Cannot select applications, grant permissions or run shell commands. Inspect a fresh snapshot before acting.',inputSchema:{type:'object',additionalProperties:false,properties:{operation:{type:'string',enum:COMPUTER_USE_ACTIONS},snapshotId:{type:'string'},index:{type:'integer'},text:{type:'string'},direction:{type:'string',enum:['up','down']},windowId:{type:'integer'}},required:['operation']} });
export function computerUseAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!Object.hasOwn(COMPUTER_USE_TOOL.inputSchema.properties,key)) || !COMPUTER_USE_ACTIONS.includes(input.operation)) throw Error('Unsupported Computer Use action.');
  if (input.operation !== 'snapshot' && (typeof input.snapshotId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.snapshotId))) throw Error('Inspect a fresh snapshot first.');
  if (['press','set-value','scroll'].includes(input.operation) && (!Number.isSafeInteger(input.index) || input.index < 0 || input.index > 299)) throw Error('Choose a current element index.');
  if (input.operation==='screenshot' && (!Number.isSafeInteger(input.windowId) || input.windowId <= 0)) throw Error('Choose a window from the snapshot.');
  if (input.operation==='set-value' && (typeof input.text!=='string' || input.text.length>20000 || input.text.includes('\0'))) throw Error('Enter bounded text.');
  if (input.operation==='scroll' && !['up','down'].includes(input.direction)) throw Error('Choose a scroll direction.');
  return {...input};
}
