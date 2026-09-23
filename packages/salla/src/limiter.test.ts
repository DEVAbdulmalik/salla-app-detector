import { describe, expect, it } from "vitest";
import { HostLimiter } from "./limiter";

/** A clock the test moves by hand, so pacing is asserted rather than waited out. */
function clock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleeps,
    sleep: (ms: number) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("HostLimiter", () => {
  it("keeps a gap between two requests to the same host", async () => {
    const time = clock();
    const limiter = new HostLimiter({ minIntervalMs: 300, now: time.now, sleep: time.sleep });
    const started: number[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limiter.run("salla.sa", () => {
        started.push(time.now());
        return Promise.resolve("ok");
      });
    }

    expect(started).toEqual([0, 300, 600]);
  });

  it("lets a different host through without waiting", async () => {
    const time = clock();
    const limiter = new HostLimiter({ minIntervalMs: 300, now: time.now, sleep: time.sleep });

    await limiter.run("salla.sa", () => Promise.resolve("ok"));
    const other = await limiter.run("mahwous.com", () => Promise.resolve(time.now()));

    expect(other).toEqual({ ok: true, value: 0 });
  });

  it("refuses a caller that would wait longer than it is worth", async () => {
    const time = clock();
    const limiter = new HostLimiter({
      minIntervalMs: 5_000,
      maxWaitMs: 1_000,
      now: time.now,
      sleep: time.sleep,
    });

    await limiter.run("salla.sa", () => Promise.resolve("ok"));
    const second = await limiter.run("salla.sa", () => Promise.resolve("ok"));

    expect(second).toEqual({ ok: false, reason: "busy" });
  });

  it("stops calling a host that refused us three times in a row", async () => {
    const time = clock();
    const limiter = new HostLimiter({
      minIntervalMs: 0,
      breakerFailures: 3,
      breakerCooldownMs: 60_000,
      now: time.now,
      sleep: time.sleep,
    });
    let calls = 0;
    const refusedCall = () =>
      limiter.run(
        "salla.sa",
        () => {
          calls += 1;
          return Promise.resolve(403);
        },
        (status) => status === 403,
      );

    await refusedCall();
    await refusedCall();
    await refusedCall();
    const afterBreak = await refusedCall();

    expect(calls).toBe(3);
    expect(afterBreak).toEqual({ ok: false, reason: "cooling-down" });
    expect(limiter.snapshot("salla.sa").coolingDown).toBe(true);
  });

  it("tries again once the cooling-down period has passed", async () => {
    const time = clock();
    const limiter = new HostLimiter({
      minIntervalMs: 0,
      breakerFailures: 2,
      breakerCooldownMs: 60_000,
      now: time.now,
      sleep: time.sleep,
    });
    const refused = () =>
      limiter.run(
        "salla.sa",
        () => Promise.resolve(403),
        (s) => s === 403,
      );

    await refused();
    await refused();
    time.advance(60_001);

    expect(await limiter.run("salla.sa", () => Promise.resolve(200))).toEqual({
      ok: true,
      value: 200,
    });
  });

  it("forgets earlier refusals once a call succeeds", async () => {
    const time = clock();
    const limiter = new HostLimiter({
      minIntervalMs: 0,
      breakerFailures: 2,
      now: time.now,
      sleep: time.sleep,
    });

    await limiter.run(
      "salla.sa",
      () => Promise.resolve(403),
      (s) => s === 403,
    );
    await limiter.run(
      "salla.sa",
      () => Promise.resolve(200),
      (s) => s === 403,
    );
    await limiter.run(
      "salla.sa",
      () => Promise.resolve(403),
      (s) => s === 403,
    );

    expect(limiter.snapshot("salla.sa").coolingDown).toBe(false);
  });
});
