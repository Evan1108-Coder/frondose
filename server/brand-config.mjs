import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** New installations use FRONDOSE_*. Existing operator secrets remain valid. */
export function frondoseEnvironment(input = process.env) {
  // A live view preserves registration/credential rotation fences. Copying this
  // object would leave services accepting a stale app registration after rotation.
  return new Proxy(input, {
    get(target, name, receiver) {
      if (typeof name === 'string' && name.startsWith('FRONDOSE_') && !Object.hasOwn(target, name)) {
        const suffix = name.slice('FRONDOSE_'.length);
        if (Object.hasOwn(target, `TALVORI_${suffix}`)) return target[`TALVORI_${suffix}`];
        return target[`RUMBO_${suffix}`];
      }
      return Reflect.get(target, name, receiver);
    },
  });
}

/** Never silently start an empty workspace beside an existing installation. */
export function frondoseDataDirectory(explicit, cwd = process.cwd()) {
  if (explicit) return resolve(explicit);
  const current = join(cwd, '.frondose');
  for (const directory of [current, join(cwd, '.talvori'), join(cwd, '.rumbo')]) {
    if (['frondose.sqlite', 'talvori.sqlite', 'rumbo.sqlite'].some(name => existsSync(join(directory, name)))) return directory;
  }
  return current;
}

export function frondoseDatabasePath(directory) {
  const current = join(directory, 'frondose.sqlite');
  for (const name of ['frondose.sqlite', 'talvori.sqlite', 'rumbo.sqlite']) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return current;
}
