export type Kind = 'image' | 'video';
export interface Parameters { size?: string; seconds?: number; aspectRatio?: string; resolution?: string }
export interface Profile { credentialId?: string; id: string; name: string; baseUrl: string; protocol: 'xai' | 'openai'; imageModel: string; videoModel: string; hasKey: boolean; allowLocal: boolean; verifiedAt?: string; updatedAt: string }
export interface Viewport { x: number; y: number; zoom: number }
export interface StudioNode { id: string; kind: 'prompt' | Kind | 'asset' | 'note'; x: number; y: number; title: string; text?: string; assetId?: string; parameters: Parameters }
export interface Edge { id: string; from: string; to: string }
export interface Project { id: string; name: string; revision: number; updatedAt: string; viewport: Viewport; nodes: StudioNode[]; edges: Edge[] }
export interface Asset { id: string; kind: Kind; name: string; mime: string; bytes: number; createdAt: string; fileName: string }
export interface Generation { id: string; profileId: string; projectId: string; nodeId?: string; kind: Kind; prompt: string; referenceAssetId?: string; parameters: Parameters }
export type JobState = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'uncertain';
export interface Job { id: string; request: Generation; profile: Profile; state: JobState; progress: number; remoteId?: string; error?: string; resultAssetId?: string; dependsOn?: string[]; createdAt: string; updatedAt: string }
export interface Snapshot { profiles: Profile[]; projects: Project[]; assets: Asset[]; jobs: Job[] }
export const emptySnapshot = (): Snapshot => ({profiles: [], projects: [], assets: [], jobs: []});
