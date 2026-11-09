// Paces a streaming reply on screen. Models (and the native bridge) hand text over in bursts; showing each burst
// as it lands reads as jumps. This lets the text flow at the rate it is arriving, a little behind it, and catches up
// quickly whenever it falls behind. Pure TypeScript with no imports, so scripts/bench-stream.mjs can run it in Node.

export type RevealOptions = {
  /** How far behind the model the text aims to run, in ms of output: the cushion that hides bursts. */
  bufferMs?: number;
  /** How quickly a backlog bigger than the cushion is worked off, in ms. */
  catchUpMs?: number;
  /** Never show text more than this far behind, in ms of output (a stall or a huge burst skips ahead). */
  maxLagMs?: number;
};

export function createReveal({ bufferMs = 70, catchUpMs = 220, maxLagMs = 450 }: RevealOptions = {}) {
  let target = 0; // characters received
  let shown = 0; // characters on screen (fractional)
  let rate = 0; // arrival rate, chars per ms (smoothed)
  let lastPush = -1;
  let done = false;
  return {
    /** The reply is now `length` characters long. */
    push(length: number, now: number) {
      if (length < shown) shown = length; // text was rewritten shorter (a tool call taken out)
      if (length > target && lastPush >= 0) {
        const gap = Math.max(16, now - lastPush);
        const inst = (length - target) / gap;
        rate = rate ? rate * 0.75 + inst * 0.25 : inst;
      }
      if (length !== target) lastPush = now;
      target = length;
    },
    /** The model finished: work off what is left within a few frames. */
    finish() {
      done = true;
    },
    /** Advances by `dt` ms; returns how many characters to show. */
    tick(dt: number): number {
      const backlog = target - shown;
      if (backlog <= 0) return Math.floor((shown = target));
      let step: number;
      if (done) step = Math.max(backlog * (dt / 120), rate * dt, 1);
      else if (!rate) step = backlog * (dt / catchUpMs) + 0.5; // first burst: rate unknown yet
      else step = rate * dt + Math.max(0, backlog - rate * bufferMs) * (dt / catchUpMs);
      shown = Math.min(target, shown + Math.max(step, 0));
      const lag = target - shown;
      const maxLag = Math.max(24, rate * maxLagMs);
      if (lag > maxLag) shown = target - maxLag;
      return Math.floor(shown);
    },
    get done() {
      return done && shown >= target;
    },
    get target() {
      return target;
    },
  };
}
export type Reveal = ReturnType<typeof createReveal>;
