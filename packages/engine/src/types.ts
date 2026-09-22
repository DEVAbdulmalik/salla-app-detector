export type PageStatus =
  "live" | "maintenance" | "closed" | "blocked" | "not-salla" | "unsupported";

export type Confidence = "confirmed" | "strong" | "possible";

export type AppStatus = "listed" | "delisted" | "unidentified";

/**
 * Where a signal was observed. The groups matter for scoring: two strong signals only
 * reinforce each other when they come from different places in the page.
 */
export type EvidenceKind =
  | "snippet"
  | "service"
  | "domain"
  | "host"
  | "inline-token"
  | "inline-marker"
  | "inline-signature"
  | "dom-id"
  | "custom-element"
  | "bundle"
  | "product-image-host"
  | "product-sku-prefix";

export interface Evidence {
  readonly kind: EvidenceKind;
  /** Normalised value used for matching, for example a registrable domain. */
  readonly value: string;
  /** Human readable context shown in the report. */
  readonly detail?: string;
}

export type FingerprintStrength = "decisive" | "strong" | "medium";

export type FingerprintTarget =
  | { readonly type: "app"; readonly appId: string }
  | { readonly type: "company"; readonly company: string; readonly appIds: readonly string[] };

export interface Fingerprint {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly pattern: string;
  readonly strength: FingerprintStrength;
  readonly target: FingerprintTarget;
  /** Share of sampled products that must carry a product signal before it counts. */
  readonly minProductShare?: number;
}

export interface AppInfo {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly company?: string;
  readonly categories?: readonly string[];
  readonly status: AppStatus;
  /** Installed on nearly every store, so it says nothing about the merchant's choices. */
  readonly isDefault?: boolean;
}

export interface NoiseRules {
  readonly hosts: readonly string[];
  readonly domains: readonly string[];
  readonly identifiers: readonly string[];
  readonly inlineSignatures: readonly string[];
  readonly markers: readonly string[];
  readonly elementIds: readonly string[];
  readonly customElements: readonly string[];
}

export interface KnowledgeSnapshot {
  readonly version: string;
  readonly apps: Readonly<Record<string, AppInfo>>;
  readonly fingerprints: readonly Fingerprint[];
  readonly noise: NoiseRules;
}

export interface ReportEvidence {
  readonly kind: EvidenceKind;
  readonly value: string;
  readonly detail?: string;
  readonly strength: FingerprintStrength;
}

export interface DetectedApp {
  readonly appId: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly company?: string;
  readonly categories: readonly string[];
  readonly status: AppStatus;
  readonly isDefault: boolean;
  readonly confidence: Confidence;
  readonly evidence: readonly ReportEvidence[];
  /** Set when a shared developer domain cannot tell the company's apps apart. */
  readonly ambiguousWith?: readonly string[];
}

export interface Integration {
  readonly key: string;
  readonly appId?: string;
  readonly name?: string;
}

export interface UnknownSignal {
  readonly kind: EvidenceKind;
  readonly value: string;
  readonly detail?: string;
}

export interface StoreSummary {
  readonly id: number;
  readonly name?: string;
  readonly username?: string;
  readonly theme?: string;
  readonly twilightVersion?: string;
}

export interface PaymentSummary {
  readonly methods: readonly string[];
  readonly installments: readonly string[];
}

export interface ScanReport {
  readonly target: { readonly url: string; readonly host: string };
  readonly status: PageStatus;
  /** Why the page ended up with this status, kept for health monitoring. */
  readonly statusDetail?: string;
  readonly store?: StoreSummary;
  readonly apps: readonly DetectedApp[];
  readonly dropshipping: readonly DetectedApp[];
  readonly integrations: readonly Integration[];
  readonly payments: PaymentSummary;
  readonly unknownSignals: readonly UnknownSignal[];
  readonly meta: {
    readonly engineVersion: string;
    readonly knowledgeVersion: string;
  };
}
