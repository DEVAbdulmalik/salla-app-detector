import type { StoreConfig } from "./config";
import type { StorefrontDocument } from "./document";
import { describeHost } from "./domains";
import type { Evidence } from "./types";

export interface EvidenceContext {
  readonly selfHost?: string;
}

/**
 * Flattens a parsed page into comparable signals. Every host contributes both its full
 * name and its registrable domain: vendors on their own domain are matched by domain,
 * while vendors sharing a platform such as pages.dev are only safe to match by host.
 */
export function collectEvidence(
  document: StorefrontDocument,
  config: StoreConfig | undefined,
  context: EvidenceContext = {},
): readonly Evidence[] {
  const evidence = new EvidenceSet();
  const selfDomain =
    context.selfHost === undefined ? undefined : describeHost(context.selfHost)?.domain;

  for (const snippet of document.snippets) {
    evidence.add({ kind: "snippet", value: snippet.appId, detail: snippet.src });
  }

  for (const key of config?.serviceKeys ?? []) {
    evidence.add({ kind: "service", value: key });
  }

  for (const resource of document.resources) {
    addHost(evidence, resource.host, resource.url, selfDomain);
  }

  for (const script of document.inlineScripts) {
    for (const host of script.hosts) {
      addHost(evidence, host, `inline script: ${host}`, selfDomain);
    }
    for (const identifier of script.identifiers) {
      evidence.add({ kind: "inline-token", value: identifier });
    }
    for (const marker of script.markers) {
      evidence.add({ kind: "inline-marker", value: marker });
    }
    evidence.add({ kind: "inline-signature", value: script.signature, detail: script.sample });
  }

  for (const id of document.elementIds) {
    evidence.add({ kind: "dom-id", value: id });
  }

  for (const element of document.customElements) {
    evidence.add({ kind: "custom-element", value: element });
  }

  for (const component of document.customComponents) {
    if (component.bundleId !== undefined) {
      evidence.add({ kind: "bundle", value: component.bundleId, detail: component.name });
    }
  }

  return evidence.values();
}

function addHost(
  evidence: EvidenceSet,
  host: string,
  detail: string,
  selfDomain: string | undefined,
): void {
  const info = describeHost(host);
  if (!info || info.domain === selfDomain) {
    return;
  }
  evidence.add({ kind: "host", value: info.host, detail });
  evidence.add({ kind: "domain", value: info.domain, detail });
}

class EvidenceSet {
  readonly #items = new Map<string, Evidence>();

  add(item: Evidence): void {
    const key = `${item.kind}:${item.value}`;
    if (!this.#items.has(key)) {
      this.#items.set(key, item);
    }
  }

  values(): readonly Evidence[] {
    return [...this.#items.values()];
  }
}
