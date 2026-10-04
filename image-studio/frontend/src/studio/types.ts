export type Kind = "image" | "video";
export interface Parameters {
  promptMode?: "verbatim" | "assisted";
  outputFormat?: string;
  inputFidelity?: string;
  quality?: string;
  endpointPath?: string;
  size?: string;
  seconds?: number;
  aspectRatio?: string;
  resolution?: string;
}
export type ImageAPI = "images" | "responses";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
/** Omitted capability fields are unknown; model discovery does not confirm them. */
export interface ImageModelCapabilities {
  qualities?: string[];
  sizes?: string[];
  formats?: string[];
  maxInputImages?: number;
  supportsMask?: boolean;
  supportsInputFidelity?: boolean;
  inputFidelityValues?: string[];
}
export interface ImageProviderCapabilities {
  schemaVersion: 1;
  preferredApi?: ImageAPI;
  images?: { generate?: boolean; edit?: boolean; stream?: boolean };
  responses?: { imageTool?: boolean; sse?: boolean; websocket?: boolean };
  promptModes?: Array<"verbatim" | "assisted">;
  /** Exact model IDs, with independent rules for each wire protocol. */
  modelRules?: Record<string, { images?: ImageModelCapabilities; responses?: ImageModelCapabilities }>;
}
/** An upstream configuration used by the Studio. */
export interface Profile {
  providerPreset?: "custom" | "sub2api";
  capabilities?: ImageProviderCapabilities;
  credentialId?: string;
  id: string;
  name: string;
  baseUrl: string;
  protocol: "xai" | "openai";
  imageModel: string;
  videoModel: string;
  hasKey: boolean;
  allowLocal: boolean;
  /** OpenAI-compatible image contract; empty means the streamed Images API. */
  imageApi?: ImageAPI | "";
  responsesTransport?: "sse" | "websocket" | "";
  requestPolicy?: "openai" | "compat" | "";
  imagesNewApiCompat?: boolean;
  /** Plain HTTP to a remote host and no certificate checks. */
  allowInsecure?: boolean;
  textModel?: string;
  reasoningEffort?: ReasoningEffort | "";
  modelIds?: string[];
  concurrencyLimit?: number;
  fallbackProfileId?: string;
  verifiedAt?: string;
  createdAt?: string;
  updatedAt: string;
}
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
export interface StudioNode {
  id: string;
  kind: "prompt" | Kind | "asset" | "note";
  x: number;
  y: number;
  title: string;
  text?: string;
  assetId?: string;
  parameters: Parameters;
}
export interface Edge {
  id: string;
  from: string;
  to: string;
}
export interface Project {
  deletedAt?: string;
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  viewport: Viewport;
  nodes: StudioNode[];
  edges: Edge[];
}
export interface Asset {
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  deletedAt?: string;
  id: string;
  kind: Kind;
  name: string;
  mime: string;
  bytes: number;
  createdAt: string;
  fileName: string;
}
export interface Generation {
  id: string;
  profileId: string;
  projectId: string;
  nodeId?: string;
  kind: Kind;
  prompt: string;
  originalPrompt?: string;
  confirmedPrompt?: string;
  image?: ImageParameters;
  referenceAssetId?: string;
  referenceAssetIds?: string[];
  maskAssetId?: string;
  parameters: Parameters;
}
export interface ImageParameters {
  quality?: string;
  outputFormat?: string;
  inputFidelity?: string;
  background?: string;
  outputCompression?: number;
  negativePrompt?: string;
  seed?: number;
  imageStyle?: string;
  moderation?: string;
  userIdentifier?: string;
  disablePreview?: boolean;
  partialImages?: number;
}
export interface ResultImage {
  assetId: string;
  itemId?: string;
  outputIndex?: number;
  revisedPrompt?: string;
  source: "final";
  width?: number;
  height?: number;
}
export type JobState = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled" | "uncertain";
export interface Job {
  id: string;
  request: Generation;
  profile: Profile;
  state: JobState;
  progress: number;
  remoteId?: string;
  error?: string;
  resultAssetId?: string;
  resultAssetIds?: string[];
  resultImages?: ResultImage[];
  parentAssetIds?: string[];
  originalPrompt?: string;
  confirmedPrompt?: string;
  sentPrompt?: string;
  revisedPrompt?: string;
  responseId?: string;
  requestId?: string;
  usage?: Record<string, unknown>;
  outputStatus?: "completed" | "failed" | "incomplete" | "uncertain";
  /** Set while a generated image waits to be downloaded. */
  resultUrl?: string;
  resultUrls?: string[];
  dependsOn?: string[];
  createdAt: string;
  updatedAt: string;
}
export interface PromptCard {
  catalogKey?: string;
  previewURL?: string;
  sourceURL?: string;
  referenceImageURLs?: string[];
  id: string;
  revision: number;
  title: string;
  prompt: string;
  kind: Kind;
  previewAssetId?: string;
  sourceJobId?: string;
  category: string;
  tags: string[];
  author?: string;
  parameters: Parameters;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface PromptView extends PromptCard {
  key: string;
  origin: "saved" | "history";
}
export interface Snapshot {
  /** Identifies the desktop process whose revisions follow. */
  epoch?: string;
  revision?: number;
  promptCards?: PromptCard[];
  profiles: Profile[];
  projects: Project[];
  assets: Asset[];
  jobs: Job[];
}
/** What changed after a revision; `full` replaces every collection. */
export interface ChangeSet {
  epoch: string;
  revision: number;
  full: boolean;
  profiles: Profile[];
  projects: Project[];
  assets: Asset[];
  jobs: Job[];
  promptCards: PromptCard[];
  removed: {
    profiles: string[];
    promptCards: string[];
    projects?: string[];
    assets?: string[];
    jobs?: string[];
  };
  /** Volatile progress of running jobs. */
  progress: Record<string, number>;
}
export const emptySnapshot = (): Snapshot => ({
  profiles: [],
  projects: [],
  assets: [],
  jobs: [],
  promptCards: [],
});
