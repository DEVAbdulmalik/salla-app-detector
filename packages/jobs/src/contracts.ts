import type { ApiFailure, AppDetails, AppReviews, CatalogApp } from "@salla-app-detector/salla";
import type { Result } from "@salla-app-detector/shared";
import type { ApiContract } from "./health";

export interface ContractClient {
  fetchAppDetails(appId: string): Promise<Result<AppDetails, ApiFailure>>;
  fetchAppReviews(appId: string, page?: number): Promise<Result<AppReviews, ApiFailure>>;
  fetchCatalog(): Promise<Result<CatalogApp[], ApiFailure>>;
}

/**
 * The reviews translator stands in for any app: Salla preinstalls it on every store, so it
 * will not vanish from the marketplace and leave a false alarm behind.
 */
const SAMPLE_APP_ID = "691365818";

/** The endpoints detection depends on, none of which Salla documents. */
export function sallaContracts(client: ContractClient): ApiContract[] {
  return [
    { name: "marketplace/apps/{id}", probe: () => client.fetchAppDetails(SAMPLE_APP_ID) },
    { name: "marketplace/apps/{id}/reviews", probe: () => client.fetchAppReviews(SAMPLE_APP_ID) },
    { name: "marketplace/search", probe: () => client.fetchCatalog() },
  ];
}
