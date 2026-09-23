import { classifyPage, type PageInput } from "./classify";
import { extractStoreConfig, type StoreConfig } from "./config";
import { parseStorefront } from "./document";
import { hostOf } from "./domains";
import { collectEvidence } from "./evidence";
import type { CompiledKnowledge } from "./knowledge";
import { matchEvidence } from "./match";
import { filterNoise } from "./noise";
import { analyzeProducts, type ProductSample } from "./products";
import { buildReport } from "./report";
import type { ScanReport, StoreSummary } from "./types";
import { ENGINE_VERSION } from "./version";

export interface AnalyzeInput {
  readonly target: { readonly url: string; readonly host: string };
  readonly page: PageInput;
  /** Sample from the store's public product listing, used for dropshipping signals. */
  readonly products?: readonly ProductSample[];
}

/**
 * The whole detection path, as one pure function: a fetched page plus a knowledge
 * snapshot in, a report out. Nothing here touches the network, so every decision can be
 * replayed against a saved page.
 */
export function analyzeStore(input: AnalyzeInput, knowledge: CompiledKnowledge): ScanReport {
  const config = extractStoreConfig(input.page.html);
  const classification = classifyPage(input.page, config.ok);

  if (classification.status !== "live") {
    return emptyReport(input, knowledge, classification.status, classification.detail);
  }

  const storeConfig = config.ok ? config.value : undefined;
  const selfHost = hostOf(input.page.finalUrl) ?? input.target.host;
  const document = parseStorefront(input.page.html, selfHost);

  const pageEvidence = collectEvidence(document, storeConfig, { selfHost });
  const { signals } = filterNoise(pageEvidence, knowledge.snapshot.noise);

  const products = analyzeProducts(input.products ?? [], knowledge);
  const { matches, unmatched } = matchEvidence([...signals, ...products.evidence], knowledge);

  return buildReport({
    target: input.target,
    status: classification.status,
    ...(storeConfig === undefined
      ? {}
      : { store: summarize(storeConfig, document.storeAssetCode) }),
    matches,
    unmatched: [...unmatched, ...products.unknownImageHosts],
    payments: {
      methods: storeConfig?.paymentMethods ?? [],
      installments: storeConfig?.installments ?? [],
    },
    knowledge,
  });
}

function summarize(config: StoreConfig, assetCode: string | undefined): StoreSummary {
  return {
    id: config.storeId,
    ...(assetCode === undefined ? {} : { assetCode }),
    ...(config.storeName === undefined ? {} : { name: config.storeName }),
    ...(config.username === undefined ? {} : { username: config.username }),
    ...(config.themeName === undefined ? {} : { theme: config.themeName }),
    ...(config.twilightVersion === undefined ? {} : { twilightVersion: config.twilightVersion }),
  };
}

function emptyReport(
  input: AnalyzeInput,
  knowledge: CompiledKnowledge,
  status: ScanReport["status"],
  detail: string | undefined,
): ScanReport {
  return {
    target: input.target,
    status,
    ...(detail === undefined ? {} : { statusDetail: detail }),
    apps: [],
    dropshipping: [],
    integrations: [],
    payments: { methods: [], installments: [] },
    unknownSignals: [],
    meta: {
      engineVersion: ENGINE_VERSION,
      knowledgeVersion: knowledge.snapshot.version,
    },
  };
}
