// Dev-only counters for streaming cost. Turn on from the dev console with `globalThis.__NERU_PERF__ = true`
// (read when a reply starts); each finished reply then logs one line. Release builds strip the `__DEV__` checks.
export const perf = {
  get on(): boolean {
    return __DEV__ && !!(globalThis as { __NERU_PERF__?: boolean }).__NERU_PERF__;
  },
  startedAt: 0,
  notifications: 0,
  blockRenders: 0,
  linesTokenized: 0,
  // Counted through methods: components may call these, but the React Compiler rejects writing module state inline.
  countBlock() {
    this.blockRenders++;
  },
  countLines(n: number) {
    this.linesTokenized += n;
  },
  start() {
    this.startedAt = Date.now();
    this.notifications = this.blockRenders = this.linesTokenized = 0;
  },
  report() {
    const s = Math.max(0.001, (Date.now() - this.startedAt) / 1000);
    console.log(`[neru perf] ${s.toFixed(1)} s: ${(this.notifications / s).toFixed(1)} row updates/s, ${this.blockRenders} block renders, ${this.linesTokenized} code lines tokenized`);
  },
};
