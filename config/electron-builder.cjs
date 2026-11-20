'use strict';
const { releaseConfiguration } = require('../desktop/update-service.cjs');
const release = releaseConfiguration(require('../desktop/release-config.json'));
module.exports = {
  appId: 'app.frondose.desktop', productName: 'Frondose',
  directories: { output: 'dist-desktop' },
  extraMetadata: { main: 'desktop/main.cjs' },
  files: ['desktop/**', 'server/**', 'src/lib/**', 'scripts/*.mjs', 'third-party/**', 'public/brand/frondose-frond-icon.png', 'dist/client/**', 'package.json', '!**/*.test.*', '!desktop/open-in-apps.cjs', '!desktop/editor-tab-setup.cjs', '!node_modules/@anthropic-ai/claude-agent-sdk-*/**'],
  asarUnpack: ['**/*.node', '**/node-pty/**', 'desktop/bin/**'],
  npmRebuild: true,
  icon: 'public/brand/frondose-frond.png',
  // A sealed ad-hoc local signature enables macOS notification identity without
  // accessing signing credentials. This is not Developer ID/notarization.
  mac: { icon: 'desktop/assets/mac/Frondose.icns', target: ['dmg', 'zip'], category: 'public.app-category.productivity', identity: '-', extendInfo: { NSMicrophoneUsageDescription: 'Frondose uses your microphone only while you explicitly record dictation.', NSSpeechRecognitionUsageDescription: 'Frondose transcribes dictation on this Mac when an on-device language is available.', NSAppleEventsUsageDescription: 'Frondose operates only the applications you explicitly select for Computer Use.' } },
  win: { target: ['nsis', 'zip'], ...(release.windowsPublisherName ? { publisherName: release.windowsPublisherName } : {}) },
  linux: { target: ['AppImage', 'deb'], category: 'Development', maintainer: 'Frondose <270086281+Evan1108-Coder@users.noreply.github.com>' },
  // Signed installers and update distribution require owner-provisioned
  // certificates and release infrastructure; no Orca update service is used.
  publish: release.feedUrl ? { provider: 'generic', url: release.feedUrl } : null,
};
