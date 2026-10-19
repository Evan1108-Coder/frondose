import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** New installations use TALVORI_*. Existing operator secrets remain valid. */
export function talvoriEnvironment(input = process.env) {
  // A live view preserves registration/credential rotation fences. Copying this
  // object would leave services accepting a stale app registration after rotation.
  return new Proxy(input, {
    get(target, name, receiver) {
      if (typeof name === 'string' && name.startsWith('TALVORI_') && !Object.hasOwn(target, name)) return target[`RUMBO_${name.slice(8)}`];
      return Reflect.get(target, name, receiver);
    },
  });
}

/** Never silently start an empty workspace beside an existing installation. */
export function talvoriDataDirectory(explicit, cwd = process.cwd()) {
  if (explicit) return resolve(explicit);
  const current = join(cwd, '.talvori');
  const legacy = join(cwd, '.rumbo');
  if (existsSync(join(current, 'talvori.sqlite')) || existsSync(join(current, 'rumbo.sqlite'))) return current;
  if (existsSync(join(legacy, 'rumbo.sqlite'))) return legacy;
  return current;
}

export function talvoriDatabasePath(directory) {
  const current = join(directory, 'talvori.sqlite');
  const legacy = join(directory, 'rumbo.sqlite');
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}
