'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

function createUpdateStorage(userData) {
  const directory = join(userData, 'app-updates'), file = join(directory, 'choices.json');
  async function checkDirectory() {
    await fs.mkdir(directory, { mode: 0o700, recursive: true });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077))) throw Error('Update preferences directory is not private.');
  }
  async function load() {
    await checkDirectory();
    let handle;
    try {
      const before = await fs.lstat(file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw Error('Update preferences cannot be linked files.');
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const info = await handle.stat();
      if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.nlink !== 1 || info.size > 16384 || process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077))) throw Error('Update preferences are not a private regular file.');
      return JSON.parse(await handle.readFile('utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    finally { await handle?.close(); }
  }
  async function save(value) {
    await checkDirectory();
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 16384) throw Error('Private preferences exceed the 16 KiB limit. Select fewer resources.');
    const temporary = join(directory, `choice-${randomUUID()}.json`);
    try { await fs.writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { load, save };
}
module.exports = { createUpdateStorage };
