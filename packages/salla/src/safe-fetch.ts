import { lookup as dnsLookup } from "node:dns";
import { err, ok, type Result } from "@salla-app-detector/shared";
// undici's own fetch is used rather than the global one: the guarded dispatcher below
// comes from this same copy of undici, and the global fetch rejects a foreign dispatcher.
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import { isBlockedAddress } from "./addresses";

export type FetchFailure =
  | { readonly code: "invalid-url"; readonly url: string }
  | { readonly code: "unsupported-scheme"; readonly scheme: string }
  | { readonly code: "blocked-address"; readonly host: string }
  | { readonly code: "too-many-redirects"; readonly url: string }
  | { readonly code: "timeout" }
  | { readonly code: "too-large"; readonly limitBytes: number }
  | { readonly code: "network"; readonly message: string };

export interface FetchedPage {
  readonly status: number;
  readonly finalUrl: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bytes: number;
  readonly redirects: readonly string[];
}

export interface SafeFetchOptions {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly attempts?: number;
  /** Only for tests that talk to a local server. Never enable in a deployed environment. */
  readonly allowPrivateAddresses?: boolean;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 5_000_000,
  maxRedirects: 5,
  attempts: 2,
} as const;

const RETRY_DELAY_MS = 400;

/**
 * Fetches a URL that someone else chose. Requests can only reach public addresses, the
 * check is applied again at connection time so a hostname cannot resolve to something
 * different after passing validation, and every redirect hop is validated the same way.
 * Responses are capped and timed so one hostile page cannot exhaust the server.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<Result<FetchedPage, FetchFailure>> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  let lastFailure: FetchFailure = { code: "network", message: "request was never attempted" };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await attemptFetch(url, options);
    if (result.ok || !isTransient(result.error)) {
      return result;
    }
    lastFailure = result.error;
    if (attempt < attempts) {
      await delay(RETRY_DELAY_MS * attempt);
    }
  }

  return err(lastFailure);
}

async function attemptFetch(
  url: string,
  options: SafeFetchOptions,
): Promise<Result<FetchedPage, FetchFailure>> {
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const dispatcher = createDispatcher(options);
  const redirects: string[] = [];

  let current = url;

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const target = parseTarget(current, options.allowPrivateAddresses === true);
      if (!target.ok) {
        return target;
      }

      const response = await undiciFetch(target.value, {
        method: options.method ?? "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULTS.timeoutMs),
        headers: { ...options.headers },
        ...(options.body === undefined ? {} : { body: options.body }),
        dispatcher,
      });

      const location = response.headers.get("location");
      if (isRedirect(response.status) && location !== null) {
        await response.body?.cancel();
        redirects.push(target.value.toString());
        current = new URL(location, target.value).toString();
        continue;
      }

      const body = await readCappedBody(response, maxBytes);
      if (!body.ok) {
        return body;
      }

      return ok({
        status: response.status,
        finalUrl: target.value.toString(),
        headers: Object.fromEntries(response.headers),
        body: body.value.text,
        bytes: body.value.bytes,
        redirects,
      });
    }

    return err({ code: "too-many-redirects", url });
  } catch (error) {
    return err(toFailure(error));
  } finally {
    void dispatcher.close();
  }
}

function createDispatcher(options: SafeFetchOptions): Agent {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  return new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connect: {
      timeout: timeoutMs,
      lookup: options.allowPrivateAddresses === true ? dnsLookup : guardedLookup,
    },
  });
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * Resolution happens inside the connection, so the address actually dialled is the one
 * that was checked. This is what closes the DNS rebinding hole that a check before the
 * request would leave open.
 */
function guardedLookup(hostname: string, options: unknown, callback: LookupCallback): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    const allowed = addresses.filter((entry) => !isBlockedAddress(entry.address));
    if (allowed.length === 0) {
      const blocked: NodeJS.ErrnoException = new Error(
        `refusing to connect to a non-public address for ${hostname}`,
      );
      blocked.code = "EBLOCKEDADDRESS";
      callback(blocked, []);
      return;
    }
    callback(null, allowed);
  });
}

function parseTarget(url: string, allowPrivate: boolean): Result<URL, FetchFailure> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err({ code: "invalid-url", url });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err({ code: "unsupported-scheme", scheme: parsed.protocol.replace(":", "") });
  }
  // A literal address never goes through DNS, so the connect-time guard would not see it.
  const host = parsed.hostname.replace(/^\[|]$/g, "");
  if (!allowPrivate && isAddressLiteral(host) && isBlockedAddress(host)) {
    return err({ code: "blocked-address", host });
  }
  return ok(parsed);
}

function isAddressLiteral(host: string): boolean {
  return /^\d/.test(host) || host.includes(":");
}

async function readCappedBody(
  response: UndiciResponse,
  maxBytes: number,
): Promise<Result<{ text: string; bytes: number }, FetchFailure>> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await response.body?.cancel();
    return err({ code: "too-large", limitBytes: maxBytes });
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  if (!reader) {
    return ok({ text: "", bytes: 0 });
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return err({ code: "too-large", limitBytes: maxBytes });
    }
    chunks.push(value);
  }

  return ok({ text: new TextDecoder().decode(concat(chunks, bytes)), bytes });
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isTransient(failure: FetchFailure): boolean {
  return failure.code === "timeout" || failure.code === "network";
}

function toFailure(error: unknown): FetchFailure {
  if (!(error instanceof Error)) {
    return { code: "network", message: String(error) };
  }
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return { code: "timeout" };
  }
  const blocked = findBlockedLookup(error);
  if (blocked) {
    return { code: "blocked-address", host: /for (\S+)$/.exec(blocked.message)?.[1] ?? "unknown" };
  }
  return { code: "network", message: error.message };
}

/** fetch wraps connection errors several layers deep, so the whole chain is inspected. */
function findBlockedLookup(error: Error): Error | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if ((current as NodeJS.ErrnoException).code === "EBLOCKEDADDRESS") {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
