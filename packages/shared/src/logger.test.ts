import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, type LogRecord } from "./logger";

const FIXED_TIME = new Date("2026-09-22T10:00:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

function recordingLogger(level?: "debug" | "info" | "warn" | "error") {
  const records: LogRecord[] = [];
  const logger = createLogger({
    ...(level === undefined ? {} : { level }),
    sink: (record) => records.push(record),
    now: () => FIXED_TIME,
  });
  return { logger, records };
}

describe("createLogger", () => {
  it("emits a structured record with time, level, message and fields", () => {
    const { logger, records } = recordingLogger();

    logger.info("scan finished", { host: "mahwous.com", durationMs: 812 });

    expect(records).toEqual([
      {
        time: "2026-09-22T10:00:00.000Z",
        level: "info",
        msg: "scan finished",
        host: "mahwous.com",
        durationMs: 812,
      },
    ]);
  });

  it("drops records below the configured level", () => {
    const { logger, records } = recordingLogger("warn");

    logger.debug("noise");
    logger.info("still noise");
    logger.warn("kept");
    logger.error("kept too");

    expect(records.map((record) => record.level)).toEqual(["warn", "error"]);
  });

  it("defaults to the info level", () => {
    const { logger, records } = recordingLogger();

    logger.debug("hidden");
    logger.info("shown");

    expect(records.map((record) => record.msg)).toEqual(["shown"]);
  });

  it("merges child bindings into every record", () => {
    const { logger, records } = recordingLogger();

    const scanLogger = logger.child({ job: "scan" }).child({ host: "aen.sa" });
    scanLogger.info("fetched", { status: 200 });

    expect(records[0]).toMatchObject({ job: "scan", host: "aen.sa", status: 200 });
  });

  it("serializes errors, including their cause", () => {
    const { logger, records } = recordingLogger();
    const cause = new TypeError("socket hang up");

    logger.error("fetch failed", { error: new Error("upstream unavailable", { cause }) });

    expect(records[0]?.error).toMatchObject({
      name: "Error",
      message: "upstream unavailable",
      cause: { name: "TypeError", message: "socket hang up" },
    });
  });

  it("writes one JSON line per record, sending warnings and errors to stderr", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const logger = createLogger({ now: () => FIXED_TIME });
    logger.info("started", { port: 3000 });
    logger.error("crashed");

    expect(out).toHaveBeenCalledWith(
      '{"time":"2026-09-22T10:00:00.000Z","level":"info","msg":"started","port":3000}',
    );
    expect(error).toHaveBeenCalledWith(
      '{"time":"2026-09-22T10:00:00.000Z","level":"error","msg":"crashed"}',
    );
  });

  it("never lets fields overwrite the reserved keys", () => {
    const { logger, records } = recordingLogger();

    logger.warn("original", { msg: "spoofed", level: "debug", time: "yesterday" });

    expect(records[0]).toEqual({
      time: "2026-09-22T10:00:00.000Z",
      level: "warn",
      msg: "original",
    });
  });
});
