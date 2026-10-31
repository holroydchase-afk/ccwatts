import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

// CCW-M4.6 bedtime nudge (Chase, Oct 31): an opt-in status-line line that tells you to go to
// sleep, in serious or funny personas. Pure core: window logic, deterministic pick, settings.

type Persona = { id: string; label: string; tone: "serious" | "funny"; lines: string[] };
type NudgeInput = { localHour: number; localMinute: number; after: number; until: number; persona: string; seed: number };
type NudgeSettings = { on: boolean; after: number; until: number; persona: string };
const api = core as unknown as {
  PERSONAS?: readonly Persona[];
  bedtimeNudge?: (input: NudgeInput) => string | null;
  parseNudgeSettings?: (text: string) => NudgeSettings;
  serializeNudgeSettings?: (s: NudgeSettings) => string;
  DEFAULT_NUDGE_SETTINGS?: NudgeSettings;
};

function personas(): readonly Persona[] {
  expect(api.PERSONAS, "PERSONAS is not exported from core").toBeDefined();
  return api.PERSONAS!;
}
function nudge(input: Partial<NudgeInput> & Pick<NudgeInput, "localHour">): string | null {
  expect(api.bedtimeNudge, "bedtimeNudge is not exported from core").toBeTypeOf("function");
  return api.bedtimeNudge!({ localMinute: 0, after: 23, until: 5, persona: "coach", seed: 1, ...input });
}
function parse(text: string): NudgeSettings {
  expect(api.parseNudgeSettings, "parseNudgeSettings is not exported from core").toBeTypeOf("function");
  return api.parseNudgeSettings!(text);
}

/** Each raw line rendered as it could be shown: {time} filled with the longest form. */
const rendered = (p: Persona) => p.lines.map((l) => l.replaceAll("{time}", "12:59am"));
/** Raw lines of a persona as regexes, {time} matching any h:mmam/pm. */
const lineRe = (raw: string) => new RegExp(`^${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{time\\\}/g, "\\d{1,2}:\\d{2}[ap]m")}$`);
const isLineOf = (p: Persona, text: string) => p.lines.some((l) => lineRe(l).test(text));

describe("CCW-M4.6 bedtime window (NUDGE-1)", () => {
  it("NUDGE-1 after=23, until=5 wraps midnight: 22:59 no, 23:00 yes, 02:30 yes, 05:00 no", () => {
    expect(nudge({ localHour: 22, localMinute: 59 })).toBeNull();
    expect(nudge({ localHour: 23, localMinute: 0 })).toEqual(expect.any(String));
    expect(nudge({ localHour: 2, localMinute: 30 })).toEqual(expect.any(String));
    expect(nudge({ localHour: 4, localMinute: 59 })).toEqual(expect.any(String));
    expect(nudge({ localHour: 5, localMinute: 0 })).toBeNull();
    expect(nudge({ localHour: 12, localMinute: 0 })).toBeNull();
  });

  it("NUDGE-1 after=21, until=6", () => {
    const at = (h: number) => nudge({ localHour: h, after: 21, until: 6 });
    expect(at(20)).toBeNull();
    for (const h of [21, 22, 23, 0, 3, 5]) expect(at(h), `hour ${h}`).toEqual(expect.any(String));
    expect(at(6)).toBeNull();
    expect(at(15)).toBeNull();
  });

  it("NUDGE-1 after < until is a same-day window (after=1, until=5)", () => {
    const at = (h: number) => nudge({ localHour: h, after: 1, until: 5 });
    for (const h of [23, 0, 5, 6, 12]) expect(at(h), `hour ${h}`).toBeNull();
    for (const h of [1, 2, 4]) expect(at(h), `hour ${h}`).toEqual(expect.any(String));
  });
});

describe("CCW-M4.6 deterministic pick (NUDGE-2)", () => {
  it("NUDGE-2 the same seed gives the same line", () => {
    for (const p of personas()) {
      const a = nudge({ localHour: 1, localMinute: 14, persona: p.id, seed: 4242 });
      const b = nudge({ localHour: 1, localMinute: 14, persona: p.id, seed: 4242 });
      expect(a, p.id).toBe(b);
      expect(isLineOf(p, a!), `${p.id}: "${a}" is not one of its lines`).toBe(true);
    }
  });

  it("NUDGE-2 hourly seeds over one night give at least 3 distinct lines per persona", () => {
    const day = 20_392; // days since epoch; the seed changes each hour
    for (const p of personas()) {
      const seen = new Set<string>();
      for (let hour = 0; hour < 24; hour++) seen.add(nudge({ localHour: 1, localMinute: 14, persona: p.id, seed: day * 24 + hour })!);
      expect(seen.size, p.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("CCW-M4.6 personas (NUDGE-3)", () => {
  it("NUDGE-3 at least 3 serious and 4 funny personas, including the named ones", () => {
    const ps = personas();
    expect(ps.filter((p) => p.tone === "serious").length).toBeGreaterThanOrEqual(3);
    expect(ps.filter((p) => p.tone === "funny").length).toBeGreaterThanOrEqual(4);
    const ids = ps.map((p) => p.id);
    for (const id of ["coach", "researcher", "grandma", "narrator", "pirate", "haiku"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("random");
    for (const p of ps) {
      expect(p.id).toMatch(/^[a-z]+$/);
      expect(p.label.length, p.id).toBeGreaterThan(0);
    }
  });

  it("NUDGE-3 each persona has at least 5 lines, each at most 90 characters when rendered", () => {
    for (const p of personas()) {
      expect(p.lines.length, p.id).toBeGreaterThanOrEqual(5);
      for (const line of rendered(p)) expect([...line].length, `${p.id}: ${line}`).toBeLessThanOrEqual(90);
    }
  });

  it("NUDGE-3 {time} is filled with the local time like 1:14am, and no token is left over", () => {
    const all = personas();
    expect(all.some((p) => p.lines.some((l) => l.includes("{time}"))), "no persona line uses {time}").toBe(true);
    const cases: [number, number, string][] = [
      [1, 14, "1:14am"],
      [0, 7, "12:07am"],
      [23, 5, "11:05pm"],
    ];
    for (const [h, m, want] of cases) {
      let found = false;
      for (const p of all)
        for (let seed = 0; seed < 200; seed++) {
          const out = nudge({ localHour: h, localMinute: m, persona: p.id, seed })!;
          expect(out, `${p.id} seed ${seed}`).not.toMatch(/[{}]/);
          if (/\d{1,2}:\d{2}[ap]m/.test(out)) {
            expect(out, `${p.id} seed ${seed}`).toContain(want);
            found = true;
          }
        }
      expect(found, `no line showed ${want}`).toBe(true);
    }
  });

  it("NUDGE-3 no health claims or diagnosis, and no shaming", () => {
    const BANNED = /burnout|health|diagnos|disorder|insomnia|doctor|medical/i;
    const SHAME = /\blazy\b|pathetic|loser/i;
    for (const p of personas())
      for (const line of [p.label, ...p.lines]) {
        expect(line, p.id).not.toMatch(BANNED);
        expect(line, p.id).not.toMatch(SHAME);
      }
  });

  it("NUDGE-3 the nudge source makes no network calls and does no I/O", () => {
    const file = fileURLToPath(new URL("../src/nudge.ts", import.meta.url));
    expect(existsSync(file), "packages/core/src/nudge.ts").toBe(true);
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/fetch\(|from "node:|require\(|XMLHttpRequest|process\.env/);
  });
});

describe("CCW-M4.6 random persona (NUDGE-4)", () => {
  it("NUDGE-4 random picks deterministically by seed, only from real personas", () => {
    const ps = personas();
    const owners = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const a = nudge({ localHour: 2, localMinute: 30, persona: "random", seed })!;
      expect(nudge({ localHour: 2, localMinute: 30, persona: "random", seed })).toBe(a);
      const owner = ps.find((p) => isLineOf(p, a));
      expect(owner, `"${a}" belongs to no persona`).toBeDefined();
      owners.add(owner!.id);
    }
    expect(owners.size).toBeGreaterThanOrEqual(3);
  });

  it("NUDGE-4 random still respects the window", () => {
    expect(nudge({ localHour: 14, persona: "random", seed: 7 })).toBeNull();
  });
});

describe("CCW-M4.6 nudge settings (NUDGE-5)", () => {
  const DEFAULTS = { on: false, after: 23, until: 5, persona: "random" };

  it("NUDGE-5 defaults are off", () => {
    expect(api.DEFAULT_NUDGE_SETTINGS, "DEFAULT_NUDGE_SETTINGS is not exported from core").toEqual(DEFAULTS);
    expect(parse("")).toEqual(DEFAULTS);
    expect(parse("not json")).toEqual(DEFAULTS);
    expect(parse("[]")).toEqual(DEFAULTS);
    expect(parse("null")).toEqual(DEFAULTS);
  });

  it("NUDGE-5 keeps valid fields and drops unknown keys", () => {
    const s = parse(JSON.stringify({ on: true, after: 22, until: 6, persona: "grandma", note: "hi", path: "<folder>/x" }));
    expect(s).toEqual({ on: true, after: 22, until: 6, persona: "grandma" });
    expect(Object.keys(s).sort()).toEqual(["after", "on", "persona", "until"]);
  });

  it("NUDGE-5 after/until must be integers 0 to 23, persona known or random, on a boolean", () => {
    const bad = (o: object) => parse(JSON.stringify({ on: true, after: 22, until: 6, persona: "pirate", ...o }));
    expect(bad({ after: 24 }).after).toBe(23);
    expect(bad({ after: -1 }).after).toBe(23);
    expect(bad({ after: 22.5 }).after).toBe(23);
    expect(bad({ after: "22" }).after).toBe(23);
    expect(bad({ until: 99 }).until).toBe(5);
    expect(bad({ until: 0 }).until).toBe(0);
    expect(bad({ persona: "dragon" }).persona).toBe("random");
    expect(bad({ persona: 3 }).persona).toBe("random");
    expect(bad({ persona: "random" }).persona).toBe("random");
    expect(bad({ on: "yes" }).on).toBe(false);
  });

  it("NUDGE-5 serialize round-trips and writes only the four known keys", () => {
    expect(api.serializeNudgeSettings, "serializeNudgeSettings is not exported from core").toBeTypeOf("function");
    const s = { on: true, after: 21, until: 6, persona: "haiku" };
    const text = api.serializeNudgeSettings!({ ...s, extra: 1 } as NudgeSettings);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["after", "on", "persona", "until"]);
    expect(parse(text)).toEqual(s);
  });
});

// Review fixes (UX-R47, UX-R48, UX-R50), Oct 31.
/** Terminal columns: the moon (and other wide emoji) take 2, everything else here takes 1. */
const columns = (s: string) => [...s].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0);

describe("CCW-M4.6 review fixes (core copy)", () => {
  it("UX-R47 every line with the moon prefix at the widest time (12:59am) fits in 78 terminal columns", () => {
    expect(columns("🌙 ")).toBe(3);
    const over: string[] = [];
    for (const p of personas())
      for (const line of rendered(p)) {
        const shown = `🌙 ${line}`;
        if (columns(shown) > 78) over.push(`${p.id} (${columns(shown)} cols): ${line}`);
      }
    expect(over, `lines wider than 78 columns:\n${over.join("\n")}`).toEqual([]);
  });

  it("UX-R48 researcher lines make no brain, body-clock or learning claims", () => {
    const researcher = personas().find((p) => p.id === "researcher");
    expect(researcher, "researcher persona").toBeDefined();
    for (const line of researcher!.lines) expect(line).not.toMatch(/brain|body clock|think more clearly|learning/i);
  });

  it("UX-R50 no line says 'best players know when to leave' or 'So will you, if you rest'", () => {
    for (const p of personas())
      for (const line of p.lines) {
        expect(line, p.id).not.toMatch(/best players know when to leave/i);
        expect(line, p.id).not.toMatch(/So will you, if you rest/i);
      }
  });
});
