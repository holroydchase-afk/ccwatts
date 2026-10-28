/**
 * What we print when something fails. Raw error messages can hold a full path (fs errors name
 * the file, which sits in your home folder) or a URL, so we print a short reason or a cut line.
 */

/** A one-word reason: the error's code (EISDIR, ENOENT, …), else its name, never its message. */
export function reason(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string") return code;
  if (error instanceof Error) return error.name;
  return "unknown error";
}

/** An error's message with any URL cut out, or a fixed sentence when it isn't an Error. */
export function errorLine(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/https?:\S+/g, "(link removed)");
  return "Something went wrong.";
}
