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

/**
 * Absolute paths in a message, POSIX or Windows, of two or more parts: "/home/a/b.jsonl",
 * "C:\\Users\\a\\b". A path must start the message or follow a space, quote or bracket, so
 * "read/write" or "~/.claude/projects" are left alone.
 */
const ABSOLUTE_PATH = /(?<=^|[\s'"`(\[])(?:[A-Za-z]:)?(?:[\\/][^\s'"`\\/)\]]+){2,}[\\/]?/g;

/** A whole quoted absolute path, as Node's fs errors write it ('/a/b c/d.jsonl'), spaces included. */
const QUOTED_PATH = /(['"`])((?:[A-Za-z]:)?[\\/][^'"`]*)\1/g;

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** An error's message with any URL cut out and any absolute path cut to its last part, or a fixed sentence when it isn't an Error. */
export function errorLine(error: unknown): string {
  if (error instanceof Error)
    return error.message
      .replace(/https?:\S+/g, "(link removed)")
      .replace(QUOTED_PATH, (_m, q: string, path: string) => `${q}${lastPart(path)}${q}`)
      .replace(ABSOLUTE_PATH, lastPart);
  return "Something went wrong.";
}
