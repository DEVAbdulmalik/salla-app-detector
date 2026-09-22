import { Parser } from "htmlparser2";
import { fnv1a } from "./hash";

export interface SnippetTag {
  readonly appId: string;
  readonly fileId?: string;
  readonly snippetId?: string;
  readonly scopeId?: string;
  readonly src: string;
}

export type ResourceTag = "script" | "link" | "iframe" | "img";

export interface ExternalResource {
  readonly tag: ResourceTag;
  readonly url: string;
  readonly host: string;
}

export interface InlineScript {
  readonly hosts: readonly string[];
  readonly identifiers: readonly string[];
  readonly markers: readonly string[];
  /** Hash of the script with literals removed, so copies with different settings match. */
  readonly signature: string;
  readonly length: number;
  readonly sample: string;
}

export interface CustomComponent {
  readonly name: string;
  readonly bundleId?: string;
}

export interface StorefrontDocument {
  readonly snippets: readonly SnippetTag[];
  readonly resources: readonly ExternalResource[];
  readonly inlineScripts: readonly InlineScript[];
  readonly customComponents: readonly CustomComponent[];
  readonly elementIds: readonly string[];
  readonly customElements: readonly string[];
  readonly gtmContainers: readonly string[];
  /** Short code Salla assigns to a store's CDN folder, useful as a store identifier. */
  readonly storeAssetCode?: string;
}

const SNIPPET_PATH = /\/snippets\/\w+\/(\d+)\/(\d+)\.js/;
const INLINE_URL = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
const WINDOW_ASSIGNMENT = /window\.([A-Za-z_$][\w$]*)\s*=/g;
const DECLARATION = /(?:const|let|var)\s+([A-Za-z_$][\w$]{3,})\s*=/g;
const LINE_COMMENT = /(?:^|\n)[ \t]*\/\/[ \t]*(\S[^\n]{3,79})/g;
const BLOCK_COMMENT = /\/\*+[ \t]*(\S[^\n*]{3,79}?)[ \t]*\*+\//g;
const GTM_CONTAINER = /GTM-[A-Z0-9]{5,9}/g;
const STORE_ASSET_CODE = /cdn\.salla\.sa\/(?:cdn-cgi\/image\/[^/]+\/)?([A-Za-z0-9]{4,8})\//;

const NON_EXECUTABLE_SCRIPT = /json|importmap/i;

const LIMITS = {
  resources: 400,
  inlineScripts: 250,
  identifiersPerScript: 60,
  markersPerScript: 15,
  elementIds: 600,
  customElements: 80,
  sampleLength: 240,
  signatureLength: 400,
} as const;

/**
 * Collects everything an app could leave behind in a storefront page. A streaming parser
 * is enough here and stays fast on the large pages Salla themes produce, since nothing
 * downstream needs a DOM tree.
 */
export function parseStorefront(html: string, selfHost?: string): StorefrontDocument {
  const snippets: SnippetTag[] = [];
  const resources: ExternalResource[] = [];
  const inlineScripts: InlineScript[] = [];
  const customComponents: CustomComponent[] = [];
  const elementIds = new Set<string>();
  const customElements = new Set<string>();

  let collecting = false;
  let scriptChunks: string[] = [];

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (attribs.id !== undefined && elementIds.size < LIMITS.elementIds) {
          elementIds.add(attribs.id);
        }
        if (name.includes("-") && customElements.size < LIMITS.customElements) {
          customElements.add(name);
        }
        if (name === "salla-custom-component") {
          customComponents.push({
            name: attribs["component-name"] ?? "",
            ...(attribs["bundle-id"] === undefined ? {} : { bundleId: attribs["bundle-id"] }),
          });
        }

        if (name === "script") {
          const src = attribs.src;
          if (src === undefined) {
            collecting = !NON_EXECUTABLE_SCRIPT.test(attribs.type ?? "");
            scriptChunks = [];
            return;
          }
          const snippet = readSnippet(src, attribs);
          if (snippet) {
            snippets.push(snippet);
          }
          addResource(resources, "script", src, selfHost);
          return;
        }

        if (name === "link" && isStylesheetLike(attribs.rel)) {
          addResource(resources, "link", attribs.href, selfHost);
        } else if (name === "iframe") {
          addResource(resources, "iframe", attribs.src, selfHost);
        } else if (name === "img") {
          addResource(resources, "img", attribs.src, selfHost);
        }
      },

      ontext(text) {
        if (collecting) {
          scriptChunks.push(text);
        }
      },

      onclosetag(name) {
        if (name !== "script" || !collecting) {
          return;
        }
        collecting = false;
        const text = scriptChunks.join("");
        scriptChunks = [];
        if (text.trim() === "" || inlineScripts.length >= LIMITS.inlineScripts) {
          return;
        }
        inlineScripts.push(describeInlineScript(text, selfHost));
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );

  parser.write(html);
  parser.end();

  return {
    snippets,
    resources,
    inlineScripts,
    customComponents,
    elementIds: [...elementIds],
    customElements: [...customElements],
    gtmContainers: [...new Set(html.match(GTM_CONTAINER) ?? [])],
    ...optionalAssetCode(html),
  };
}

function readSnippet(src: string, attribs: Record<string, string>): SnippetTag | undefined {
  // The attribute is the reliable marker: snippets are served from more than one host.
  if (attribs["data-snippet-id"] === undefined && !SNIPPET_PATH.test(src)) {
    return undefined;
  }
  const match = SNIPPET_PATH.exec(src);
  if (!match?.[1]) {
    return undefined;
  }
  return {
    appId: match[1],
    ...(match[2] === undefined ? {} : { fileId: match[2] }),
    ...(attribs["data-snippet-id"] === undefined ? {} : { snippetId: attribs["data-snippet-id"] }),
    ...(attribs["data-scope-id"] === undefined ? {} : { scopeId: attribs["data-scope-id"] }),
    src,
  };
}

function addResource(
  resources: ExternalResource[],
  tag: ResourceTag,
  rawUrl: string | undefined,
  selfHost: string | undefined,
): void {
  if (rawUrl === undefined || resources.length >= LIMITS.resources) {
    return;
  }
  const url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  if (!url.startsWith("http")) {
    return;
  }
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return;
  }
  if (host === selfHost) {
    return;
  }
  resources.push({ tag, url: url.split("?")[0] ?? url, host });
}

function describeInlineScript(text: string, selfHost: string | undefined): InlineScript {
  const hosts = new Set<string>();
  for (const match of text.matchAll(INLINE_URL)) {
    const host = match[1]?.toLowerCase();
    if (host !== undefined && host !== selfHost) {
      hosts.add(host);
    }
  }

  const identifiers = new Set<string>();
  for (const pattern of [WINDOW_ASSIGNMENT, DECLARATION]) {
    for (const match of text.matchAll(pattern)) {
      if (identifiers.size >= LIMITS.identifiersPerScript) {
        break;
      }
      if (match[1] !== undefined) {
        identifiers.add(match[1]);
      }
    }
  }

  const markers = new Set<string>();
  for (const pattern of [LINE_COMMENT, BLOCK_COMMENT]) {
    for (const match of text.matchAll(pattern)) {
      if (markers.size >= LIMITS.markersPerScript) {
        break;
      }
      const marker = normalizeMarker(match[1] ?? "");
      if (marker.length >= 4) {
        markers.add(marker);
      }
    }
  }

  return {
    hosts: [...hosts],
    identifiers: [...identifiers],
    markers: [...markers],
    signature: fnv1a(structuralForm(text)),
    length: text.length,
    sample: text.trim().slice(0, LIMITS.sampleLength),
  };
}

/** Strips values so that only the shape of the code remains. */
function structuralForm(text: string): string {
  return text
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "S")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.signatureLength);
}

function normalizeMarker(marker: string): string {
  return marker.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Link relations that name a third-party host. Apps commonly warm up their CDN with a
 * preconnect, which is as telling as loading a file from it.
 */
const RESOURCE_RELS = new Set([
  "stylesheet",
  "preload",
  "modulepreload",
  "preconnect",
  "dns-prefetch",
]);

function isStylesheetLike(rel: string | undefined): boolean {
  if (rel === undefined) {
    return false;
  }
  return rel
    .toLowerCase()
    .split(/\s+/)
    .some((value) => RESOURCE_RELS.has(value));
}

function optionalAssetCode(html: string): { storeAssetCode?: string } {
  const code = STORE_ASSET_CODE.exec(html)?.[1];
  return code === undefined ? {} : { storeAssetCode: code };
}
