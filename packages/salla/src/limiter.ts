export interface LimiterOptions {
  /** Requests allowed to be in flight against one host. */
  readonly concurrency?: number;
  /** Shortest gap between two requests starting against one host. */
  readonly minIntervalMs?: number;
  /** How long a request may wait for its turn before giving up. */
  readonly maxWaitMs?: number;
  /** Consecutive refusals from a host before we stop calling it for a while. */
  readonly breakerFailures?: number;
  readonly breakerCooldownMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type LimiterRefusal = "busy" | "cooling-down";

interface HostState {
  running: number;
  nextStartAt: number;
  failures: number;
  openUntil: number;
}

const DEFAULTS = {
  concurrency: 2,
  minIntervalMs: 300,
  maxWaitMs: 8_000,
  breakerFailures: 3,
  breakerCooldownMs: 60_000,
} as const;

/**
 * Paces our own requests to one host and stops calling it after a run of refusals.
 *
 * A burst of scans against the same platform reads as an attack and gets challenged, and
 * once that happens every visitor sees a block. Waiting a moment in a queue is a better
 * answer than a wall of failures, and backing off after repeated refusals gives the other
 * side room to forget about us instead of confirming its judgement.
 */
export class HostLimiter {
  readonly #options: Required<Omit<LimiterOptions, "now" | "sleep">>;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #hosts = new Map<string, HostState>();

  constructor(options: LimiterOptions = {}) {
    this.#options = {
      concurrency: options.concurrency ?? DEFAULTS.concurrency,
      minIntervalMs: options.minIntervalMs ?? DEFAULTS.minIntervalMs,
      maxWaitMs: options.maxWaitMs ?? DEFAULTS.maxWaitMs,
      breakerFailures: options.breakerFailures ?? DEFAULTS.breakerFailures,
      breakerCooldownMs: options.breakerCooldownMs ?? DEFAULTS.breakerCooldownMs,
    };
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Runs `work` when the host's turn comes, or refuses: "cooling-down" while the breaker
   * is open, "busy" when the wait would be longer than a visitor should sit through.
   */
  async run<T>(
    host: string,
    work: () => Promise<T>,
    refused: (result: T) => boolean = () => false,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: LimiterRefusal }> {
    const state = this.#stateOf(host);

    if (this.#now() < state.openUntil) {
      return { ok: false, reason: "cooling-down" };
    }

    const waitedOut = await this.#waitForTurn(state);
    if (!waitedOut) {
      return { ok: false, reason: "busy" };
    }

    state.running += 1;
    try {
      const value = await work();
      this.#record(state, refused(value));
      return { ok: true, value };
    } finally {
      state.running -= 1;
    }
  }

  /** Slots taken and time reserved, for a caller that reports its own state. */
  snapshot(host: string): { running: number; coolingDown: boolean } {
    const state = this.#hosts.get(host);
    return {
      running: state?.running ?? 0,
      coolingDown: state !== undefined && this.#now() < state.openUntil,
    };
  }

  async #waitForTurn(state: HostState): Promise<boolean> {
    const deadline = this.#now() + this.#options.maxWaitMs;

    for (;;) {
      const now = this.#now();
      const free = state.running < this.#options.concurrency;
      const due = now >= state.nextStartAt;

      if (free && due) {
        state.nextStartAt = now + this.#options.minIntervalMs;
        return true;
      }
      if (now >= deadline) {
        return false;
      }

      const untilDue = due ? this.#options.minIntervalMs : state.nextStartAt - now;
      await this.#sleep(Math.max(1, Math.min(untilDue, deadline - now)));
    }
  }

  #record(state: HostState, wasRefused: boolean): void {
    if (!wasRefused) {
      state.failures = 0;
      return;
    }
    state.failures += 1;
    if (state.failures >= this.#options.breakerFailures) {
      state.openUntil = this.#now() + this.#options.breakerCooldownMs;
      state.failures = 0;
    }
  }

  #stateOf(host: string): HostState {
    const existing = this.#hosts.get(host);
    if (existing) {
      return existing;
    }
    const created: HostState = { running: 0, nextStartAt: 0, failures: 0, openUntil: 0 };
    this.#hosts.set(host, created);
    return created;
  }
}
