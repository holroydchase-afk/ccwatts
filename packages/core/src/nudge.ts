/**
 * CCW-M4.6 bedtime nudge: an opt-in line for the status line that suggests going to sleep, in a
 * serious or a funny persona. Pure: the caller passes the local time and a seed (we use
 * days-since-epoch * 24 + local hour), so the line changes each hour and stays put within one.
 * Copy rules: warm, short (<= 75 characters with {time} filled, so "🌙 " plus the line fits 78 terminal columns), never shaming, no health claims.
 */

export type PersonaTone = "serious" | "funny";
export type Persona = { readonly id: string; readonly label: string; readonly tone: PersonaTone; readonly lines: readonly string[] };
export type NudgeSettings = { on: boolean; after: number; until: number; persona: string };
export type NudgeInput = {
  localHour: number;
  localMinute: number;
  /** Window start, local hour 0-23 (inclusive). */
  after: number;
  /** Window end, local hour 0-23 (exclusive). Wraps past midnight when after > until. */
  until: number;
  /** A persona id, or "random" to pick one by seed. */
  persona: string;
  seed: number;
};

/** {time} is filled with the local time, like "1:14am". */
export const PERSONAS: readonly Persona[] = [
  {
    id: "coach",
    label: "Calm coach",
    tone: "serious",
    lines: [
      "Strong session. It's {time}, and the next rep belongs to a rested you.",
      "Recovery is part of training. Close the laptop and bank tonight's progress.",
      "You've earned the cooldown. Commit, push, lights out.",
      "Good work today. Leaving the field is part of the game.",
      "Still going at {time}? Note tomorrow's first step and call it a night.",
      "Finish the thought, not the backlog. The rest can wait for daylight.",
      "Pace beats sprint. Tonight's lap is done; tomorrow's starts fresh.",
    ],
  },
  {
    id: "researcher",
    label: "Sleep researcher",
    tone: "serious",
    lines: [
      "Observation: it's {time}. The experiment can resume after breakfast.",
      "Field note: subject still typing. Recommend studying the inside of eyelids.",
      "Data point: {time}, screen still bright. Next step: dim it, close it.",
      "Hypothesis: this bug looks easier in the morning. Tomorrow, we test it.",
      "Finding: the bed remains unused. Recommend correcting this tonight.",
      "Log entry: tired eyes read diffs slowly. Tomorrow's review will be quicker.",
      "Method: save, commit, sleep. The results replicate across most nights.",
    ],
  },
  {
    id: "stoic",
    label: "Stoic",
    tone: "serious",
    lines: [
      "Consider the hour: {time}. What is in your control is closing the laptop.",
      "The work will be here at dawn. Meet it rested.",
      "Marcus Aurelius wrote about mornings. Those start with going to bed.",
      "Not everything can be finished. Today can. At {time}, today is done.",
      "Rest is not retreat. It is how tomorrow's discipline is made.",
      "The night asks little of you: put down the work and let it be.",
      "The bug is indifferent to your fatigue. Meet it rested.",
    ],
  },
  {
    id: "grandma",
    label: "Grandma",
    tone: "funny",
    lines: [
      "Sweetheart, it's {time}. The computer will still be there in the morning.",
      "I'm not saying anything. I'm just saying it's {time}.",
      "Did you eat dinner? Never mind, it's bedtime now. I made up the spare room.",
      "In my day we went to bed when it got dark. It got dark hours ago, dear.",
      "I knitted you a blanket. It works best when you're asleep under it.",
      "Such a hard worker. Now be a good sleeper too. Kisses. Bed.",
      "Your little robot friend can wait, love. Grandma says bed.",
    ],
  },
  {
    id: "narrator",
    label: "Nature documentary",
    tone: "funny",
    lines: [
      "At {time}, the developer persists, long after the herd has gone to rest.",
      "Observe: the rare night coder, lit only by the glow of a terminal.",
      "The developer circles the bug once more. Instinct says: return to the nest.",
      "Few creatures stir at {time}. Most of them are owls. You are not an owl.",
      "Remarkable. Even the cursor seems to blink more slowly now.",
      "Soon the developer will begin the great migration: from desk to bed.",
      "In the wild, the well-rested coder outlasts the merge conflict.",
    ],
  },
  {
    id: "pirate",
    label: "Pirate",
    tone: "funny",
    lines: [
      "Arr, it be {time}! Drop anchor on that branch and swing into yer hammock.",
      "The tide o' commits can wait till mornin', matey. To yer bunk!",
      "Even Blackbeard slept, ye scallywag. Probably. Bed!",
      "Ship it at dawn, not at {time}. Even pirates wait for daylight.",
      "Batten down the laptop! Yer night watch be over.",
      "X marks the spot, and the spot be yer pillow.",
      "Shiver me timbers, still sailin' at {time}? Furl the sails, sailor.",
    ],
  },
  {
    id: "haiku",
    label: "Haiku",
    tone: "funny",
    // Each line is a real 5-7-5 haiku; "/" without spaces keeps it within 75 characters.
    lines: [
      "Moonlight on the keys/the terminal still glowing/save it, then to bed",
      "The bug will wait here/patient as a sleeping cat/so should you, my friend",
      "Commit, push, log off/the stars are on the night shift/go and get some rest",
      "Blue light on your face/even owls have clocked out now/pillow is calling",
      "Just one more, you say/the clock has heard this before/close the lid gently",
      "Late night, cursor blinks/each blink a small, sleepy yawn/follow its advice",
      "Tomorrow's fresh mind/will fix in five minutes what/tonight's took an hour",
    ],
  },
  {
    id: "sergeant",
    label: "Drill sergeant (friendly)",
    tone: "funny",
    lines: [
      "Attention, recruit! It is {time}. Your orders: lights out. Dismissed!",
      "Drop and give me eight... hours. Of sleep. That's an order!",
      "I don't see a bed under you, soldier! Fix that. Double time!",
      "Outstanding work today, private. Now hit the rack like you mean it!",
      "Laptop: closed! Screen: off! Recruit: horizontal! Move, move, move!",
      "At this hour, recruit, the only thing you deploy is a pillow. Hup!",
      "Proud of you, recruit. Prouder if you're asleep in five. Go!",
    ],
  },
];

export const DEFAULT_NUDGE_SETTINGS: Readonly<NudgeSettings> = Object.freeze({ on: false, after: 23, until: 5, persona: "random" });

/** "1:14am", "12:07am", "11:05pm". */
export function clockTime(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}

/** True when the local hour is in [after, until), wrapping past midnight when after > until. */
export function inBedtimeWindow(hour: number, after: number, until: number): boolean {
  if (after === until) return false;
  return after < until ? hour >= after && hour < until : hour >= after || hour < until;
}

/** A small integer hash, so nearby seeds give unrelated picks. */
function mix(seed: number, salt: number): number {
  let h = (Math.trunc(seed) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

const byId = (id: string) => PERSONAS.find((p) => p.id === id);

/** The persona a setting resolves to: a known id, or a seeded pick for "random" (or anything unknown). */
export function nudgePersona(persona: string, seed: number): Persona {
  return byId(persona) ?? PERSONAS[mix(seed, 0x9e3779b9) % PERSONAS.length]!;
}

/** One line from a persona, picked by seed, with {time} filled. Ignores the window (used for previews). */
export function personaLine(input: Pick<NudgeInput, "localHour" | "localMinute" | "persona" | "seed">): string {
  const p = nudgePersona(input.persona, input.seed);
  const raw = p.lines[mix(input.seed, 0x85ebca6b) % p.lines.length]!;
  return raw.replaceAll("{time}", clockTime(input.localHour, input.localMinute));
}

/** The nudge line (without the moon) for this moment, or null outside the bedtime window. */
export function bedtimeNudge(input: NudgeInput): string | null {
  if (!inBedtimeWindow(input.localHour, input.after, input.until)) return null;
  return personaLine(input);
}

const isHour = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
const isPersona = (v: unknown): v is string => typeof v === "string" && (v === "random" || byId(v) !== undefined);

/** Strict parse of nudge.json: each field is kept only if valid, else its default. Unknown keys are dropped. */
export function parseNudgeSettings(text: string): NudgeSettings {
  const d = DEFAULT_NUDGE_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...d };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const o = raw as Record<string, unknown>;
  return {
    on: typeof o.on === "boolean" ? o.on : d.on,
    after: isHour(o.after) ? o.after : d.after,
    until: isHour(o.until) ? o.until : d.until,
    persona: isPersona(o.persona) ? o.persona : d.persona,
  };
}

/** nudge.json text with only the four known keys. */
export function serializeNudgeSettings(s: NudgeSettings): string {
  return `${JSON.stringify({ on: s.on, after: s.after, until: s.until, persona: s.persona }, null, 2)}\n`;
}
