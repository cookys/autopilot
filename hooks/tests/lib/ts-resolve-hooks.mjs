// Node module-customisation hooks for tests: resolve the extensionless relative imports of mods/live/*.ts (the mod is bundled by the
// engine, so its sources omit extensions). Register with ts-resolve-register.mjs (node --import).
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/.test(specifier)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const ext of ['.ts', '.tsx']) {
      if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
    }
  }
  return next(specifier, context);
}
