import { safeName } from "./sanitize.js";
import type { ProjectRef } from "./types.js";

/** FNV-1a, 64-bit. Pure JS so the core runs unchanged in the browser. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Reduce a full path to a hash plus its basename, so no full path is ever stored. The id hashes
 * the full path before the name is cleaned and cut, so two long or odd names never merge.
 */
export function projectRef(cwd: string): ProjectRef {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const base = trimmed.split(/[\\/]/).pop() || trimmed;
  // A session run at the filesystem root has no basename; a name of only control characters is empty once cleaned.
  const name = trimmed === "" ? "(root)" : safeName(base) || "(unnamed)";
  return { id: fnv1a64(trimmed), name };
}
