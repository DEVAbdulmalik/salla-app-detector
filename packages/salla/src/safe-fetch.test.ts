import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeFetch, type FetchFailure, type FetchedPage } from "./safe-fetch";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let origin: string;
let handler: Handler = (_request, response) => {
  response.end("ok");
};

beforeAll(async () => {
  server = createServer((request, response) => {
    handler(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

function serve(next: Handler): void {
  handler = next;
}

async function fetchLocal(
  path: string,
  options: Parameters<typeof safeFetch>[1] = {},
): Promise<FetchedPage> {
  const result = await safeFetch(`${origin}${path}`, { allowPrivateAddresses: true, ...options });
  if (!result.ok) {
    throw new Error(`expected a page, got ${result.error.code}`);
  }
  return result.value;
}

async function failureOf(
  url: string,
  options: Parameters<typeof safeFetch>[1] = {},
): Promise<FetchFailure> {
  const result = await safeFetch(url, options);
  if (result.ok) {
    throw new Error(`expected a failure, got HTTP ${String(result.value.status)}`);
  }
  return result.error;
}

describe("safeFetch address guard", () => {
  it("refuses to reach loopback and link-local addresses", async () => {
    expect(await failureOf("http://127.0.0.1/")).toMatchObject({ code: "blocked-address" });
    expect(await failureOf("http://localhost/")).toMatchObject({ code: "blocked-address" });
    expect(await failureOf("http://169.254.169.254/latest/meta-data/")).toMatchObject({
      code: "blocked-address",
    });
  });

  it("refuses a literal address that never goes through name resolution", async () => {
    expect(await failureOf("http://[::1]/")).toMatchObject({ code: "blocked-address" });
    expect(await failureOf("http://192.168.0.1/admin")).toMatchObject({
      code: "blocked-address",
      host: "192.168.0.1",
    });
  });

  it("refuses schemes other than http and https", async () => {
    expect(await failureOf("ftp://example.com/file")).toMatchObject({
      code: "unsupported-scheme",
      scheme: "ftp",
    });
    expect(await failureOf("not a url")).toMatchObject({ code: "invalid-url" });
  });

  it("refuses a redirect that points at a private address", async () => {
    serve((_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1:9/" });
      response.end();
    });

    const failure = await safeFetch(`${origin}/redirect`, {
      allowPrivateAddresses: false,
      attempts: 1,
    });

    expect(failure.ok).toBe(false);
  });
});

describe("safeFetch", () => {
  it("returns the body, status and headers", async () => {
    serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html", "x-store": "salla" });
      response.end("<html>store</html>");
    });

    const page = await fetchLocal("/");

    expect(page).toMatchObject({
      status: 200,
      body: "<html>store</html>",
      bytes: 18,
      redirects: [],
    });
    expect(page.headers["x-store"]).toBe("salla");
  });

  it("follows redirects and reports where it ended up", async () => {
    serve((request, response) => {
      if (request.url === "/start") {
        response.writeHead(301, { location: "/middle" });
        response.end();
      } else if (request.url === "/middle") {
        response.writeHead(302, { location: `${origin}/end` });
        response.end();
      } else {
        response.end("arrived");
      }
    });

    const page = await fetchLocal("/start");

    expect(page.body).toBe("arrived");
    expect(page.finalUrl).toBe(`${origin}/end`);
    expect(page.redirects).toHaveLength(2);
  });

  it("gives up on a redirect loop", async () => {
    serve((_request, response) => {
      response.writeHead(302, { location: "/loop" });
      response.end();
    });

    const failure = await failureOf(`${origin}/loop`, {
      allowPrivateAddresses: true,
      maxRedirects: 3,
    });

    expect(failure).toMatchObject({ code: "too-many-redirects" });
  });

  it("stops reading a response that exceeds the cap", async () => {
    serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("x".repeat(4096));
    });

    const failure = await failureOf(`${origin}/big`, {
      allowPrivateAddresses: true,
      maxBytes: 1024,
    });

    expect(failure).toMatchObject({ code: "too-large", limitBytes: 1024 });
  });

  it("times out instead of hanging", async () => {
    serve(() => {
      // Never responds.
    });

    const failure = await failureOf(`${origin}/slow`, {
      allowPrivateAddresses: true,
      timeoutMs: 150,
      attempts: 1,
    });

    expect(failure).toMatchObject({ code: "timeout" });
  });

  it("retries a request that failed for a transient reason", async () => {
    let calls = 0;
    serve((_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.destroy();
        return;
      }
      response.end("second time lucky");
    });

    const page = await fetchLocal("/flaky", { attempts: 2 });

    expect(page.body).toBe("second time lucky");
    expect(calls).toBe(2);
  });

  it("does not retry a response the server meant to send", async () => {
    let calls = 0;
    serve((_request, response) => {
      calls += 1;
      response.writeHead(404);
      response.end("missing");
    });

    const page = await fetchLocal("/missing");

    expect(page.status).toBe(404);
    expect(calls).toBe(1);
  });
});
