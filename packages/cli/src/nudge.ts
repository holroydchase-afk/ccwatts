import { APP_NAME, DEFAULT_NUDGE_SETTINGS, PERSONAS, bedtimeNudge, clockTime, inBedtimeWindow, personaLine, type NudgeSettings } from "@ccwatts/core";
import { readNudgeSettings, writeNudgeSettings } from "./store.js";

// CCW-M4.6 bedtime nudge: settings in ~/.ccwatts/nudge.json, a 🌙 line under the status line.

const MOON = "🌙";
const SAMPLE_HOUR = 1;
const SAMPLE_MINUTE = 14;

/**
 * The current time. CCWATTS_NOW (an ISO time) is a test-only override so tests can run the
 * status line "at 1:14am"; it is honoured only when NODE_ENV is "test" (PS-R16), is not a user
 * setting and isn't documented in --help.
 */
export function nudgeNow(env: NodeJS.ProcessEnv = process.env): Date {
  const forced = env.NODE_ENV === "test" ? env[`${APP_NAME.toUpperCase()}_NOW`] : undefined;
  const d = forced ? new Date(forced) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Local hour, minute and a seed that changes each local hour and is stable within it. */
function moment(now: Date) {
  const days = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
  return { localHour: now.getHours(), localMinute: now.getMinutes(), seed: days * 24 + now.getHours() };
}

/** The status line's second line, or null when the nudge is off or it's outside the window. Never throws. */
export async function statusNudge(now = nudgeNow()): Promise<string | null> {
  try {
    const s = await readNudgeSettings();
    if (!s.on) return null;
    const line = bedtimeNudge({ ...moment(now), after: s.after, until: s.until, persona: s.persona });
    return line ? `${MOON} ${line}` : null;
  } catch {
    return null;
  }
}

const hourLabel = (h: number) => clockTime(h, 0).replace(":00", "");
const PERSONA_IDS = () => [...PERSONAS.map((p) => p.id), "random"].join(", ");
const ID_WIDTH = Math.max(...PERSONAS.map((p) => p.id.length));

function checkPersona(id: string): string {
  if (id === "random" || PERSONAS.some((p) => p.id === id)) return id;
  throw new Error(`Unknown persona "${id}". Pick one of: ${PERSONA_IDS()}.`);
}

function checkHour(flag: string, value: string): number {
  const n = Number(value);
  if (!/^\d{1,2}$/.test(value) || n > 23) throw new Error(`${flag} takes an hour from 0 to 23 (24-hour clock), for example ${flag} 23.`);
  return n;
}

/** The moment to show samples at: the real time inside the window, else 1:14am. */
function sampleMoment(now: Date, after = DEFAULT_NUDGE_SETTINGS.after, until = DEFAULT_NUDGE_SETTINGS.until) {
  const m = moment(now);
  return inBedtimeWindow(m.localHour, after, until) ? m : { ...m, localHour: SAMPLE_HOUR, localMinute: SAMPLE_MINUTE };
}

/** "For example, at 1:14am:" and one line from the chosen persona (UX-R46, UX-R51). */
function example(now: Date, s: NudgeSettings): string[] {
  const at = sampleMoment(now, s.after, s.until);
  return [`For example, at ${clockTime(at.localHour, at.localMinute)}:`, "", `  ${MOON} ${personaLine({ ...at, persona: s.persona })}`];
}

/** A sample line per persona. Uses the real time inside the default window, else 1:14am. */
function preview(now: Date, only?: string): string {
  const at = sampleMoment(now);
  const list = only && only !== "random" ? PERSONAS.filter((p) => p.id === only) : PERSONAS;
  // A different seed per persona, so the preview shows a spread of lines rather than the same slot.
  const rows = list.map((p, i) => `  ${MOON} ${p.id.padEnd(ID_WIDTH)}  ${personaLine({ ...at, persona: p.id, seed: at.seed * PERSONAS.length + i })}`);
  return [`How each persona sounds at ${clockTime(at.localHour, at.localMinute)}:`, "", ...rows].join("\n");
}

const describe = (s: NudgeSettings) => `${s.persona === "random" ? "a random persona each hour" : s.persona}, from ${hourLabel(s.after)} to ${hourLabel(s.until)}`;

export async function runNudge(args: { action?: string | undefined; persona?: string | undefined; after?: string | undefined; until?: string | undefined; preview?: boolean | undefined }): Promise<string> {
  const now = nudgeNow();
  const persona = args.persona === undefined ? undefined : checkPersona(args.persona);
  const after = args.after === undefined ? undefined : checkHour("--after", args.after);
  const until = args.until === undefined ? undefined : checkHour("--until", args.until);

  if (args.preview) return preview(now, persona);

  if (args.action === "on" || args.action === "off") {
    const current = await readNudgeSettings();
    const next: NudgeSettings = {
      on: args.action === "on",
      after: after ?? current.after,
      until: until ?? current.until,
      persona: persona ?? current.persona,
    };
    if (next.after === next.until) throw new Error(`--after and --until can't be the same hour. Try: ${APP_NAME} nudge on --after 23 --until 5`);
    await writeNudgeSettings(next);
    if (!next.on) return `Bedtime nudge off. The status line is back to energy only.`;
    return [
      `Bedtime nudge on: ${describe(next)}.`,
      `It shows under the ${APP_NAME} status line: set it up with /${APP_NAME}:statusline in the plugin, or see "Status line" in the README.`,
      "",
      ...example(now, next),
      "",
      `Turn it off with: ${APP_NAME} nudge off`,
    ].join("\n");
  }
  if (args.action !== undefined) throw new Error(`Unknown nudge action "${args.action}". Use: ${APP_NAME} nudge on, ${APP_NAME} nudge off or ${APP_NAME} nudge --preview.`);

  const s = await readNudgeSettings();
  if (s.on) return [`Bedtime nudge is on: ${describe(s)}. Turn it off with: ${APP_NAME} nudge off`, "", ...example(now, s), "", `See them all: ${APP_NAME} nudge --preview`].join("\n");
  return [`Bedtime nudge is off. Turn it on with: ${APP_NAME} nudge on --persona <id> (default: random)`, "", preview(now)].join("\n");
}
