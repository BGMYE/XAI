import type { HistoryItem } from "../types/domain";
interface MigrationDependencies {
  restoreCompatibility(): Promise<unknown>;
  prepareUpstreams(): Promise<unknown>;
  withHistoryLock<T>(action: () => Promise<T>): Promise<T>;
  loadHistory(): Promise<HistoryItem[]>;
  importHistory(history: HistoryItem[], warn: (message: string) => void): Promise<HistoryItem[]>;
  persistHistory(history: HistoryItem[]): Promise<void>;
}
export function createLegacyMigration(dependencies: MigrationDependencies): {
  prepare(): Promise<void>;
  takeWarning(): string;
};
