/**
 * `verify-arena --rules-only`'s proof that a run never reached the legacy
 * engine (#459).
 *
 * Installed before any suite is imported, it wraps every module under
 * `src/lib/arena/engine/` as it is loaded: each exported function still
 * exists — `engines.ts` builds its `LEGACY` adapter out of them at import
 * time, and importing is not playing — but *calling* one records the name and
 * throws `LegacyCalled`. A suite that passes under the guard therefore made no
 * legacy call at all, directly or through a shared module (`view.ts`,
 * `beats.ts`, `probe.ts`) that still reaches into `engine/` for a legacy
 * board: the recording catches a call some `try` swallowed, and the run fails
 * on it all the same.
 *
 * This is the shape #118 leaves behind: once the legacy engine is deleted,
 * `--rules-only` is what `npm test` is, and this file goes with the engine.
 */
import Module from "node:module";
import path from "node:path";

export class LegacyCalled extends Error {
  constructor(readonly what: string) {
    super(`the legacy engine was called: ${what}`);
    this.name = "LegacyCalled";
  }
}

/** Every legacy function called under the guard, as `file:name`, in the order first seen. */
export const LEGACY_CALLS = new Set<string>();

const ENGINE_DIR = path.join(__dirname, "../../src/lib/arena/engine") + path.sep;

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader; _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string };

export function installLegacyGuard(): void {
  const load = mod._load;
  const wrapped = new Map<string, unknown>();
  mod._load = function (request: string, parent: unknown, isMain: boolean) {
    const exports = load.call(this, request, parent, isMain);
    let file: string;
    try {
      file = mod._resolveFilename(request, parent, isMain);
    } catch {
      return exports;
    }
    if (!file.startsWith(ENGINE_DIR) || !exports || typeof exports !== "object") return exports;
    if (!wrapped.has(file)) {
      const short = path.basename(file).replace(/\.ts$/, "");
      const fns = new Map<PropertyKey, unknown>();
      wrapped.set(
        file,
        new Proxy(exports as Record<PropertyKey, unknown>, {
          get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (typeof value !== "function") return value;
            if (!fns.has(key)) {
              const name = `engine/${short}:${String(key)}`;
              fns.set(key, function (this: unknown) {
                LEGACY_CALLS.add(name);
                throw new LegacyCalled(name);
              });
            }
            return fns.get(key);
          },
        }),
      );
    }
    return wrapped.get(file);
  };
}
