import type {PromptCard} from './types';
export interface PublicPrompt extends PromptCard {catalogKey: string; sourceID: string; imageMode: 'edit' | 'generate'; imageModel: string}
export const CATALOG_BASE: string;
export const CATALOG_SOURCES: readonly {id: string; name: string}[];
export function catalogURL(id: string): string;
export function safePublicURL(value: unknown, image?: boolean): string;
export function catalogKeyValid(key: unknown): boolean;
export function catalogMetadata(input: Partial<PromptCard>): {catalogKey: string; previewURL: string; sourceURL: string; referenceImageURLs: string[]};
export function parseCatalog(text: string, sourceID: string): {cards: PublicPrompt[]; rejected: number; blockedLinks: number};
