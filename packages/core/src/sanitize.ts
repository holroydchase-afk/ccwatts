/**
 * Names that come from log files (model ids, folder basenames) are shown in terminals, HTML and
 * a model's context. A crafted log could put escape codes or bidi overrides in them, so we strip
 * C0 and C1 controls (ESC included), DEL, and the bidi marks, embeddings, overrides and isolates,
 * then cap the length.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export const NAME_MAX = 64;

/** A display-safe name: no control or bidi characters, at most `max` UTF-16 units, cut with "…". */
export function safeName(value: string, max = NAME_MAX): string {
  const clean = value.replace(UNSAFE, "");
  if (clean.length <= max) return clean;
  let out = "";
  // Cut by code point so an emoji is never split in half.
  for (const ch of clean) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}
