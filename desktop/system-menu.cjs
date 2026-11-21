'use strict';

const separator = { type: 'separator' };
const count = (value, singular, plural) => `${value} ${value === 1 ? singular : plural}`;

function desktopMenu({ preferences, supported, attention, preview, awakeActive, workingCount, waitingCount }, actions) {
  const invoke = callback => () => { void Promise.resolve().then(callback).catch(actions.error); };
  const action = (label, callback, extra = {}) => ({ label, click: invoke(callback), ...extra });
  const shortcut = (label, destination) => action(label, () => actions.route(destination));
  const group = (label, submenu) => ({ label, submenu });
  const toggle = (label, key) => action(label, () => actions.toggle(key), { type: 'checkbox', checked: preferences[key] });
  const choice = (label, key, value) => action(label, () => actions.set(key, value), { type: 'radio', checked: preferences[key] === value });
  const info = label => ({ label, enabled: false });
  const activity = workingCount || waitingCount
    ? [workingCount && count(workingCount, 'agent working', 'agents working'), waitingCount && count(waitingCount, 'needs input', 'need input')].filter(Boolean).join(' · ')
    : 'No active agent work';

  return [
    action('Open Frondose', actions.open),
    shortcut('Search Workspace…', 'search'),
    group('Workspace', [
      shortcut('Workspace Home', 'workspace'),
      shortcut('To Do List', 'todos'),
      shortcut('Routes', 'routes'),
      shortcut('Projects', 'projects'),
      shortcut('Automations', 'automations'),
      separator,
      action('Open Document Preview…', actions.document),
    ]),
    separator,
    group(attention ? 'Activity · Needs Attention' : 'Activity', [
      info(activity),
      separator,
      action('Clear Attention Dot', actions.clear, { enabled: attention }),
      action(preview ? 'End Dot Preview' : 'Preview Attention Dot', actions.preview),
    ]),
    group('Window & Startup', [
      action('Hide Workspace Window', actions.hide),
      toggle('Keep Running When Window Closes', 'keepRunning'),
      ...(supported.login ? [separator, toggle('Open at Login', 'openAtLogin')] : []),
    ]),
    group(awakeActive ? 'Keep Awake · Active' : 'Keep Awake', [
      choice('Off', 'keepAwake', 'off'),
      choice('While an Agent Is Working', 'keepAwake', 'working'),
      choice('While Frondose Is Open', 'keepAwake', 'on'),
    ]),
    ...(supported.dock ? [group('Dock Icon', [
      choice('Classic', 'dockIcon', 'classic'),
      choice('Indigo', 'dockIcon', 'indigo'),
      choice('Paper', 'dockIcon', 'paper'),
    ])] : []),
    separator,
    action('Desktop Settings…', actions.settings),
    action('Check for Updates…', actions.updates),
    group('Help', [shortcut('Frondose Docs', 'docs'), action('About Frondose', actions.about)]),
    separator,
    action('Quit Frondose', actions.quit),
    action('Quit and Stop Sessions…', () => actions.quit(true)),
  ];
}

module.exports = { desktopMenu };
