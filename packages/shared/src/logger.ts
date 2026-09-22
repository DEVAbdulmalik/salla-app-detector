export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

export interface LogRecord {
  readonly time: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [field: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly bindings?: LogFields;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const satisfies readonly LogLevel[];

const RESERVED_KEYS = new Set(["time", "level", "msg"]);

/**
 * Structured JSON logger. Each call emits one self-contained record so logs stay
 * queryable on hosted platforms that ingest stdout line by line.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const { level = "info", bindings = {}, sink = writeToConsole, now = () => new Date() } = options;
  const threshold = LOG_LEVELS.indexOf(level);

  const emit = (recordLevel: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(recordLevel) < threshold) {
      return;
    }
    sink({
      time: now().toISOString(),
      level: recordLevel,
      msg,
      ...serializeFields(bindings),
      ...serializeFields(fields),
    });
  };

  return {
    debug: (msg, fields) => {
      emit("debug", msg, fields);
    },
    info: (msg, fields) => {
      emit("info", msg, fields);
    },
    warn: (msg, fields) => {
      emit("warn", msg, fields);
    },
    error: (msg, fields) => {
      emit("error", msg, fields);
    },
    child: (childBindings) =>
      createLogger({ level, sink, now, bindings: { ...bindings, ...childBindings } }),
  };
}

function serializeFields(fields: LogFields): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!RESERVED_KEYS.has(key)) {
      serialized[key] = value instanceof Error ? serializeError(value) : value;
    }
  }
  return serialized;
}

function serializeError(error: Error): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  if (error.cause !== undefined) {
    serialized.cause = error.cause instanceof Error ? serializeError(error.cause) : error.cause;
  }
  return serialized;
}

function writeToConsole(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === "warn" || record.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
