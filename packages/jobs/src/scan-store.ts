import {
  analyzeStore,
  extractStoreConfig,
  hostOf,
  normalizeTarget,
  type CompiledKnowledge,
  type ProductSample,
  type ScanReport,
  type StoreTarget,
  type TargetError,
} from "@salla-app-detector/engine";
import type { ApiFailure, FetchFailure, ProductSummary } from "@salla-app-detector/salla";
import { err, ok, type Logger, type Result } from "@salla-app-detector/shared";

export interface ScanClient {
  fetchStorefront(url: string): Promise<
    Result<
      {
        readonly status: number;
        readonly finalUrl: string;
        readonly headers: Readonly<Record<string, string>>;
        readonly body: string;
      },
      FetchFailure
    >
  >;
  fetchProducts(storeId: number, perPage?: number): Promise<Result<ProductSummary[], ApiFailure>>;
}

export interface ScanOptions {
  readonly client: ScanClient;
  readonly knowledge: CompiledKnowledge;
  readonly productSampleSize?: number;
  readonly logger?: Logger;
}

export type ScanFailure =
  | { readonly code: "invalid-input"; readonly reason: TargetError }
  | { readonly code: "fetch-failed"; readonly reason: FetchFailure };

export interface ScanOutcome {
  readonly report: ScanReport;
  readonly target: StoreTarget;
  /** Set when the product sample could not be read; detection still ran without it. */
  readonly productsUnavailable?: ApiFailure;
}

const DEFAULT_SAMPLE_SIZE = 30;

/**
 * Scans one store end to end: resolve what was pasted, fetch the storefront, and analyse
 * it. The product sample is only fetched for a live store, and a failure there degrades
 * the report to storefront-only detection rather than failing the scan.
 */
export async function scanStore(
  input: string,
  options: ScanOptions,
): Promise<Result<ScanOutcome, ScanFailure>> {
  const target = normalizeTarget(input);
  if (!target.ok) {
    return err({ code: "invalid-input", reason: target.error });
  }

  const page = await options.client.fetchStorefront(target.value.url);
  if (!page.ok) {
    return err({ code: "fetch-failed", reason: page.error });
  }

  const html = page.value.body;
  const finalUrl = page.value.finalUrl;
  const host = hostOf(finalUrl) ?? target.value.host;
  const config = extractStoreConfig(html);

  let products: readonly ProductSample[] = [];
  let productsUnavailable: ApiFailure | undefined;

  if (config.ok) {
    const sample = await options.client.fetchProducts(
      config.value.storeId,
      options.productSampleSize ?? DEFAULT_SAMPLE_SIZE,
    );
    if (sample.ok) {
      products = sample.value;
    } else {
      productsUnavailable = sample.error;
      options.logger?.warn("product sample unavailable", {
        host,
        storeId: config.value.storeId,
        reason: sample.error.code,
      });
    }
  }

  const report = analyzeStore(
    {
      target: { url: finalUrl, host },
      page: {
        status: page.value.status,
        finalUrl,
        html,
        headers: page.value.headers,
      },
      products,
    },
    options.knowledge,
  );

  return ok({
    report,
    target: target.value,
    ...(productsUnavailable === undefined ? {} : { productsUnavailable }),
  });
}
