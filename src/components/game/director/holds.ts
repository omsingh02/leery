import type { CardCode, RoomView } from "@/lib/types";

/**
 * "Presentation holds": the server's state changes the instant something happens (the pile is
 * emptied the moment a bluff is called, a hand grows before the cards have visibly travelled), but
 * the story needs those changes to *land* when the picture does. A hold pins what's shown to an
 * earlier value until the matching animation arrives, then lets go.
 */
export interface Holds {
  /** Show this many cards in the pile instead of the real count. */
  pile?: number;
  /** Show these hand sizes (by player id) instead of the real ones. */
  cards?: Record<string, number>;
  /** Show this hand instead of mine. */
  hand?: CardCode[];
}

export const NO_HOLDS: Holds = {};

export const isEmpty = (h: Holds): boolean => h.pile === undefined && h.cards === undefined && h.hand === undefined;

/** The view as it should be *presented*. Returns `view` itself when nothing is held (so memoised children stay put). */
export function applyHolds(view: RoomView, h: Holds): RoomView {
  if (isEmpty(h)) return view;
  const cards = h.cards;
  const hand = h.hand;
  const players =
    cards || hand
      ? view.players.map((p) => {
          if (hand && p.id === view.me.id) return { ...p, cards: hand.length };
          const c = cards?.[p.id];
          return c === undefined ? p : { ...p, cards: c };
        })
      : view.players;
  return {
    ...view,
    pile: h.pile ?? view.pile,
    players,
    me: hand ? { ...view.me, hand: [...hand] } : view.me,
  };
}

/** Merge two hold sets (later wins per field). */
export function mergeHolds(a: Holds, b: Holds): Holds {
  const out: Holds = { ...a, ...b };
  if (a.cards || b.cards) out.cards = { ...a.cards, ...b.cards };
  return out;
}

/** Drop the given fields. */
export function release(h: Holds, ...keys: (keyof Holds)[]): Holds {
  const out: Holds = { ...h };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Holds that must be in force from the very first paint of a new snapshot — otherwise the picture
 * would flash the finished state for a frame before the director catches up:
 *  - a bluff was called: the pile, the picker's count and (if it's me) my hand stay as they were;
 *  - another player just played: the pile stays at its old count until their cards land.
 * Returns null when the transition needs none.
 */
export function arrivalHolds(prev: RoomView, next: RoomView): Holds | null {
  const meId = next.me.id;

  if (next.status === "reveal" && next.reveal && prev.status !== "reveal") {
    const rv = next.reveal;
    const picker = next.players.find((p) => p.id === rv.picker);
    if (!picker) return null;
    return {
      pile: rv.pickup,
      cards: { [rv.picker]: picker.cards - rv.pickup },
      hand: rv.picker === meId ? [...prev.me.hand] : undefined,
    };
  }

  const lastSeen = prev.log.length ? prev.log[prev.log.length - 1].n : 0;
  const play = next.log.find((e) => e.n > lastSeen && e.k === "play" && e.p && e.p !== meId);
  if (play && next.status === "challenge" && next.pile >= (play.c ?? 1)) return { pile: next.pile - (play.c ?? 1) };

  return null;
}
