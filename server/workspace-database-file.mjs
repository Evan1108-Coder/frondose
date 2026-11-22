import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync } from 'node:fs';

// SQLite's default file mode follows the process umask. Workspace records
// contain private content even if provider secrets are stored separately.
// Set the mode before SQLite can write, without following links or changing
// mode on any unrelated file in the selected data directory.
export function prepareWorkspaceDatabaseFile(path) {
  const current = lstatSync(path, { throwIfNoEntry: false });
  if (current && (!current.isFile() || current.nlink !== 1)) {
    throw new Error('The Frondose workspace database must be a regular, unlinked file.');
  }
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR |
    (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.nlink !== 1 || (current && (current.ino !== file.ino || current.dev !== file.dev))) {
      throw new Error('The Frondose workspace database changed while opening.');
    }
    // Windows stores permissions in ACLs, not the POSIX mode field.
    if (process.platform !== 'win32' && (file.mode & 0o777) !== 0o600) {
      if (file.uid !== process.getuid()) throw new Error('The Frondose workspace database must belong to the current user.');
      fchmodSync(fd, 0o600);
    }
  } finally {
    closeSync(fd);
  }
}
