import { importCompatibilityStateIfNewer } from "../lib/compatState";
import { loadAllHistory, persistHistoryItems } from "../lib/storage";
import { prepareSharedUpstreams } from "../lib/upstreamRegistry";
import { importSharedHistory, withSharedHistoryLock } from "../state/sharedHistory";
import { createLegacyMigration } from "./legacyMigrationPlan.mjs";

// The sole Studio entry imports existing data without mounting the old store.
const migration = createLegacyMigration({
  restoreCompatibility: importCompatibilityStateIfNewer,
  prepareUpstreams: prepareSharedUpstreams,
  withHistoryLock: withSharedHistoryLock,
  loadHistory: loadAllHistory,
  importHistory: importSharedHistory,
  persistHistory: persistHistoryItems,
});
export const prepareLegacyStudioData = migration.prepare;
export const takeMigrationWarning = migration.takeWarning;
