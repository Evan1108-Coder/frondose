import {
  Monitor, ShieldUser, DatabaseBackup, ShieldBan, ShieldEllipsis, ShieldHalf,
  Laptop, LaptopMinimal, MonitorCog, MonitorCheck, MonitorPlay, MonitorDot, MonitorPause, MonitorOff,
  MonitorDown, MonitorUp, MonitorX, Cpu, Microchip, MemoryStick, CircuitBoard, Router, Server, ServerCog, ServerCrash, ServerOff,
  HardDriveDownload, HardDriveUpload, CloudCog, CloudCheck, CloudOff, CloudDownload, CloudUpload, Radio, TowerControl, Satellite, SatelliteDish,
  CableCar, MousePointer, MousePointer2, KeyboardMusic, KeyboardOff, Touchpad, TouchpadOff, Usb, Bluetooth, BluetoothConnected,
  BluetoothSearching, Wifi, WifiHigh, WifiLow, WifiZero, Signal,
  Binary, Brackets, FileCode, FileCode2, FileJson, FileJson2, FileKey, Fingerprint, FileLock, ScanFace, FileCog, FileDigit, FileInput, FileOutput, FileTerminal, Database,
} from 'lucide';

// Explicit per-topic geometry, shared by cards, search and article headers.
const TOPICS = [
  ['computer-connections', 'Monitor', Monitor], ['computer-agent-permissions', 'ShieldUser', ShieldUser], ['computer-session-history', 'DatabaseBackup', DatabaseBackup],
  ['account-openrouter', 'ShieldBan', ShieldBan], ['account-huggingface', 'ShieldEllipsis', ShieldEllipsis], ['account-copilot', 'ShieldHalf', ShieldHalf],
  ['computer-claude', 'Laptop', Laptop], ['computer-codex', 'LaptopMinimal', LaptopMinimal], ['computer-copilot', 'MonitorCog', MonitorCog],
  ['computer-opencode', 'MonitorCheck', MonitorCheck], ['computer-pi', 'MonitorPlay', MonitorPlay], ['computer-omp', 'MonitorDot', MonitorDot],
  ['computer-antigravity', 'MonitorPause', MonitorPause], ['computer-muse', 'MonitorOff', MonitorOff],
  ['computer-agoragentic-acp', 'MonitorDown', MonitorDown], ['computer-amp-acp', 'MonitorUp', MonitorUp], ['computer-auggie', 'MonitorX', MonitorX],
  ['computer-autohand', 'Cpu', Cpu], ['computer-cline', 'Microchip', Microchip], ['computer-codebuddy-code', 'MemoryStick', MemoryStick],
  ['computer-codewhale', 'CircuitBoard', CircuitBoard], ['computer-cortex-code', 'Router', Router], ['computer-corust-agent', 'Server', Server],
  ['computer-crow-cli', 'ServerCog', ServerCog], ['computer-cursor', 'ServerCrash', ServerCrash], ['computer-deepagents', 'ServerOff', ServerOff],
  ['computer-devin', 'HardDriveDownload', HardDriveDownload], ['computer-dimcode', 'HardDriveUpload', HardDriveUpload], ['computer-dirac', 'CloudCog', CloudCog],
  ['computer-factory-droid', 'CloudCheck', CloudCheck], ['computer-fast-agent', 'CloudOff', CloudOff], ['computer-gemini', 'CloudDownload', CloudDownload],
  ['computer-gjc', 'CloudUpload', CloudUpload], ['computer-glm-acp-agent', 'Radio', Radio], ['computer-goose', 'TowerControl', TowerControl],
  ['computer-grok', 'Satellite', Satellite], ['computer-hermes', 'SatelliteDish', SatelliteDish], ['computer-hoplite', 'CableCar', CableCar],
  ['computer-junie', 'MousePointer', MousePointer], ['computer-kilo', 'MousePointer2', MousePointer2], ['computer-kiro', 'KeyboardMusic', KeyboardMusic],
  ['computer-kimi', 'KeyboardOff', KeyboardOff], ['computer-minimax-code', 'Touchpad', Touchpad], ['computer-minion-code', 'TouchpadOff', TouchpadOff],
  ['computer-mistral-vibe', 'Usb', Usb], ['computer-nova', 'Bluetooth', Bluetooth], ['computer-poolside', 'BluetoothConnected', BluetoothConnected],
  ['computer-qoder', 'BluetoothSearching', BluetoothSearching], ['computer-qwen-code', 'Wifi', Wifi], ['computer-sigit', 'WifiHigh', WifiHigh],
  ['computer-stakpak', 'WifiLow', WifiLow], ['computer-traecli', 'WifiZero', WifiZero], ['computer-vtcode', 'Signal', Signal],
  ['api-openrouter', 'Binary', Binary], ['api-huggingface', 'Brackets', Brackets], ['api-openai', 'FileCode', FileCode], ['api-anthropic', 'FileCode2', FileCode2],
  ['api-gemini', 'FileJson', FileJson], ['api-xai', 'FileJson2', FileJson2], ['api-mistral', 'FileKey', FileKey], ['api-deepseek', 'Fingerprint', Fingerprint],
  ['api-groq', 'FileLock', FileLock], ['api-together', 'ScanFace', ScanFace], ['api-fireworks', 'FileCog', FileCog], ['api-cohere', 'FileDigit', FileDigit],
  ['api-perplexity', 'FileInput', FileInput], ['api-moonshot', 'FileOutput', FileOutput], ['api-qwen', 'FileTerminal', FileTerminal], ['api-zai', 'Database', Database],
];
export const DOC_AI_ARTICLE_ICONS = Object.freeze(Object.fromEntries(TOPICS.map(([id, iconName, iconNode]) => [id, { iconName, iconNode }])));
