import { join } from 'node:path';
import { homedir } from 'node:os';
import local from '../desktop/local-update.cjs';

const [source, option, profile, ...extra] = process.argv.slice(2);
if (!source || (option && (option !== '--profile' || !profile)) || extra.length) {
  console.error('Usage: node scripts/stage-local-update.mjs /path/to/Frondose.app [--profile /path/to/test-profile]');
  process.exitCode = 1;
} else {
  try {
    const version = await local.stageLocalUpdate({ source, userData: profile || join(homedir(), 'Library/Application Support/Frondose') });
    console.log(`Staged Frondose ${version}. Open Frondose to review the local update, or wait for the popup if it is already open.`);
  } catch (error) {
    console.error(`Unable to stage the local update: ${error.message}`);
    process.exitCode = 1;
  }
}
