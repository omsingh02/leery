import type {
  CardCode,
  ChallengeView,
  LogEntry,
  PlayerView,
  RevealView,
  RoomPreview,
  RoomView,
  TurnView,
} from "@/lib/types";

/**
 * Hand-written room snapshots for every phase, used by the dev gallery (`/__dev?state=…`) and by
 * screenshot tests. They follow exactly what the server sends (see `lib/types.ts`).
 * Server times are generated relative to `now` so countdowns look live.
 */

const ME = "p-me";

const player = (
  id: string,
  seat: number,
  name: string,
  cards: number,
  extra: Partial<PlayerView> = {},
): PlayerView => ({
  id,
  seat,
  name,
  color: seat,
  host: false,
  bot: false,
  style: null,
  auto: false,
  left: false,
  online: true,
  cards,
  ...extra,
});

const FOUR = (me: Partial<PlayerView> = {}, counts = [12, 13, 14, 13]): PlayerView[] => [
  player(ME, 0, "Alex", counts[0], { host: true, ...me }),
  player("p-mira", 1, "Mira", counts[1]),
  player("p-vex", 2, "Vex", counts[2], { bot: true, style: "reckless" }),
  player("p-juno", 3, "Juno", counts[3], { bot: true, style: "paranoid" }),
];

const HAND: CardCode[] = ["AS", "3H", "3D", "7S", "7H", "9C", "10D", "JH", "JS", "QC", "KD", "KH"];

const MANY: CardCode[] = (() => {
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["S", "H", "D", "C"];
  const out: CardCode[] = [];
  for (const r of ranks) for (const s of suits) out.push(`${r}${s}`);
  return out.filter((_, i) => i % 52 < 31 && i % 5 !== 3).slice(0, 30);
})();

const log = (now: number): LogEntry[] => [
  { n: 1, t: now - 60000, k: "start" },
  { n: 2, t: now - 52000, k: "play", p: "p-mira", pn: "Mira", c: 2, r: "A" },
  { n: 3, t: now - 41000, k: "play", p: "p-vex", pn: "Vex", c: 1, r: "2" },
  { n: 4, t: now - 30000, k: "call", p: "p-juno", pn: "Juno", a: "p-vex", an: "Vex", b: true, x: 5 },
  { n: 5, t: now - 12000, k: "play", p: ME, pn: "Alex", c: 1, r: "4" },
];

const base = (now: number, over: Partial<RoomView> = {}): RoomView => ({
  v: 42,
  now,
  code: "K7QXM2",
  status: "turn",
  settings: { speed: "standard", turnSeconds: 45, challengeSeconds: 6 },
  players: FOUR(),
  me: {
    id: ME,
    seat: 0,
    host: true,
    hand: HAND,
    auto: false,
    passed: false,
    canPlay: false,
    canCall: false,
    canPass: false,
  },
  pile: 7,
  turn: null,
  challenge: null,
  reveal: null,
  winner: null,
  due: null,
  log: log(now),
  ...over,
});

const turnOf = (player: string, now: number, human = true): TurnView => ({
  player,
  rank: "7",
  since: now - 8000,
  deadline: human ? now + 31000 : null,
});

const challengeBy = (by: string, now: number): ChallengeView => ({
  by,
  count: 2,
  rank: "7",
  since: now - 1500,
  deadline: now + 4500,
  passed: [],
});

const revealOf = (bluff: boolean, now: number): RevealView => ({
  caller: ME,
  accused: "p-mira",
  cards: bluff ? ["4C", "9H"] : ["7C", "7D"],
  rank: "7",
  bluff,
  picker: bluff ? "p-mira" : ME,
  pickup: 9,
  winner: null,
  until: now + 4200,
});

export const FIXTURE_NAMES = [
  "lobby-host",
  "lobby-guest",
  "lobby-full",
  "turn-mine",
  "turn-mine-many",
  "turn-theirs",
  "turn-bot",
  "turn-auto",
  "turn-last-card",
  "challenge-call",
  "challenge-passed",
  "challenge-accused",
  "reveal-bluff",
  "reveal-honest",
  "eight-players",
  "finished-win",
  "finished-lose",
  "preview",
  "preview-started",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function fixture(name: FixtureName, now = Date.now()): RoomView | RoomPreview {
  switch (name) {
    case "lobby-host":
      return base(now, {
        status: "lobby",
        pile: 0,
        log: [],
        players: [
          player(ME, 0, "Alex", 0, { host: true }),
          player("p-mira", 1, "Mira", 0),
          player("p-vex", 2, "Vex", 0, { bot: true, style: "reckless" }),
        ],
        me: { ...base(now).me, hand: [] },
      });
    case "lobby-guest":
      return base(now, {
        status: "lobby",
        pile: 0,
        log: [],
        players: [
          player("p-mira", 0, "Mira", 0, { host: true }),
          player(ME, 1, "Alex", 0),
          player("p-vex", 2, "Vex", 0, { bot: true, style: "cautious" }),
        ],
        me: { ...base(now).me, seat: 1, host: false, hand: [] },
      });
    case "lobby-full":
      return base(now, {
        status: "lobby",
        pile: 0,
        log: [],
        players: eight(),
        me: { ...base(now).me, hand: [] },
      });
    case "turn-mine":
      return base(now, {
        turn: turnOf(ME, now),
        due: now + 31000,
        me: { ...base(now).me, canPlay: true },
      });
    case "turn-mine-many":
      return base(now, {
        turn: turnOf(ME, now),
        due: now + 31000,
        pile: 18,
        players: FOUR({}, [30, 7, 8, 7]),
        me: { ...base(now).me, hand: MANY, canPlay: true },
      });
    case "turn-theirs":
      return base(now, { turn: turnOf("p-mira", now), due: now + 31000 });
    case "turn-bot":
      return base(now, { turn: turnOf("p-vex", now, false), due: now + 1400 });
    case "turn-last-card":
      // somebody is down to one card, somebody to two: the table should feel the pressure
      return base(now, { turn: turnOf("p-mira", now), due: now + 31000, players: FOUR({}, [12, 13, 1, 2]) });
    case "turn-auto":
      return base(now, {
        turn: turnOf(ME, now, false),
        due: now + 1400,
        players: FOUR({ auto: true }),
        me: { ...base(now).me, auto: true },
      });
    case "challenge-call":
      return base(now, {
        status: "challenge",
        challenge: challengeBy("p-mira", now),
        due: now + 4500,
        pile: 9,
        me: { ...base(now).me, canCall: true, canPass: true },
      });
    case "challenge-passed":
      return base(now, {
        status: "challenge",
        challenge: { ...challengeBy("p-mira", now), passed: [ME] },
        due: now + 4500,
        pile: 9,
        me: { ...base(now).me, passed: true },
      });
    case "challenge-accused":
      return base(now, {
        status: "challenge",
        challenge: { ...challengeBy(ME, now), passed: ["p-mira"] },
        due: now + 4500,
        pile: 9,
      });
    case "reveal-bluff":
      return base(now, { status: "reveal", reveal: revealOf(true, now), due: now + 4200, pile: 0 });
    case "reveal-honest":
      return base(now, { status: "reveal", reveal: revealOf(false, now), due: now + 4200, pile: 0 });
    case "eight-players":
      return base(now, {
        players: eight(),
        turn: { ...turnOf("p-p5", now), player: "p-p5" },
        due: now + 31000,
        me: { ...base(now).me, canPlay: false },
      });
    case "finished-win":
      return base(now, {
        status: "finished",
        winner: ME,
        pile: 4,
        players: FOUR({}, [0, 6, 9, 3]),
        me: { ...base(now).me, hand: [] },
      });
    case "finished-lose":
      return base(now, {
        status: "finished",
        winner: "p-vex",
        pile: 4,
        players: FOUR({}, [7, 6, 0, 3]),
      });
    case "preview":
      return { preview: true, code: "K7QXM2", status: "lobby", count: 3, max: 8, host: "Mira", joinable: true, reason: null };
    case "preview-started":
      return { preview: true, code: "K7QXM2", status: "turn", count: 4, max: 8, host: "Mira", joinable: false, reason: "started" };
  }
}

/** A full table of 8 (seat 5 is an offline human, seats 2+ are bots). */
function eight(): PlayerView[] {
  const names = ["Alex", "Mira", "Vex", "Juno", "Rook", "Nyx", "Dex", "Kit"];
  return names.map((n, i) =>
    player(i === 0 ? ME : `p-p${i}`, i, n, 6 + ((i * 3) % 5), {
      host: i === 0,
      bot: i >= 2 && i !== 5,
      style: i >= 2 && i !== 5 ? (["reckless", "paranoid", "cautious", "balanced"] as const)[i % 4] : null,
      online: i !== 5,
    }),
  );
}
