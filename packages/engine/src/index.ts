export { analyzeStore } from "./analyze";
export type { AnalyzeInput } from "./analyze";

export { normalizeTarget } from "./target";
export type { StoreTarget, StoreTargetKind, TargetError } from "./target";

export { classifyPage } from "./classify";
export type { PageClassification, PageInput } from "./classify";

export { extractStoreConfig } from "./config";
export type { ConfigError, StoreConfig } from "./config";

export { parseStorefront } from "./document";
export type {
  CustomComponent,
  ExternalResource,
  InlineScript,
  ResourceTag,
  SnippetTag,
  StorefrontDocument,
} from "./document";

export { collectEvidence } from "./evidence";
export { filterNoise } from "./noise";
export type { NoiseSplit } from "./noise";

export { describeHost, hostOf } from "./domains";
export type { HostInfo } from "./domains";

export { compileKnowledge } from "./knowledge";
export type { CompiledKnowledge } from "./knowledge";

export { matchEvidence } from "./match";
export type { Match, MatchResult } from "./match";

export { analyzeProducts } from "./products";
export type { ProductAnalysis, ProductSample } from "./products";

export { confidenceOf } from "./score";
export { buildReport } from "./report";
export type { ReportInput } from "./report";

export { fnv1a } from "./hash";
export { ENGINE_VERSION } from "./version";

export type {
  AppInfo,
  ThemeInfo,
  AppStatus,
  Confidence,
  DetectedApp,
  Evidence,
  EvidenceKind,
  Fingerprint,
  FingerprintStrength,
  FingerprintTarget,
  Integration,
  KnowledgeSnapshot,
  NoiseRules,
  PageStatus,
  PaymentSummary,
  ReportEvidence,
  ScanReport,
  StoreSummary,
  UnknownSignal,
} from "./types";
