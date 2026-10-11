import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { withSharedHistoryLock } from "../src/state/sharedHistory.ts";

// Execute the real store actions with controlled persistence and bridge calls.
// Other store domains are deliberately excluded from this race regression.
const text = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("store.ts", text, ts.ScriptTarget.Latest, true);
let loadMore, startShared;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === "loadMoreHistory")
    loadMore = node.initializer.getText(source);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "startSharedHistory")
    startShared = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);

for (const pendingPage of [false, true])
  test(`shared recovery closes pagination, including an in-flight page (${pendingPage})`, async () => {
    const all = Array.from({ length: 32 }, (_, i) => ({ id: `h${i}`, createdAt: 1000 - i }));
    let state = {
      history: all.slice(0, 18),
      historyHasMore: true,
      historyLoading: false,
      historyCursorBeforeDayStart: 500,
      pushToast: assert.fail,
    };
    let finishPage;
    let pages = 0;
    let refresh;
    const deps = {
      withSharedHistoryLock,
      get: () => state,
      set: (patch) => {
        state = { ...state, ...patch };
      },
      useStudioStore: {
        getState: () => state,
        setState: (patch) => {
          state = { ...state, ...patch };
        },
      },
      loadHistoryPage: async () => {
        pages++;
        if (pendingPage)
          await new Promise((resolve) => {
            finishPage = resolve;
          });
        return { items: all.slice(18), nextCursor: null };
      },
      loadAllHistory: async () => all,
      importSharedHistory: async (items) => items,
      readSharedHistory: async (items) => items,
      persistHistoryItems: async () => {},
      removeHistoryItem: async () => {},
      backfillHistoryPreviewRefs: async () => {},
      trimHistory: (items) => items.slice(0, 120),
      EventsOn: (_event, fn) => {
        refresh = fn;
      },
      INITIAL_HISTORY_LOAD: 18,
      MAX_HISTORY_ITEMS: 120,
    };
    const { outputText } = ts.transpileModule(
      `
    let deferredHistoryLoadPromise = null;
    let sharedHistoryStarted = false, sharedHistorySync = null, sharedHistoryAgain = false;
    ${startShared}
    return { startSharedHistory, loadMoreHistory: ${loadMore}, idle: () => sharedHistorySync };
  `,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
    );
    const actions = Function(...Object.keys(deps), outputText)(...Object.values(deps));
    const page = pendingPage ? actions.loadMoreHistory() : null;
    const started = actions.startSharedHistory();
    if (pendingPage) {
      await new Promise((resolve) => setImmediate(resolve));
      finishPage();
    }
    await Promise.all([started, page]);
    await actions.idle();
    await actions.loadMoreHistory();
    assert.equal(pages, pendingPage ? 1 : 0);
    assert.equal(state.historyHasMore, false);
    assert.equal(state.historyCursorBeforeDayStart, null);
    assert.equal(state.historyLoading, false);
    assert.equal(state.history.length, 32);
    assert.equal(new Set(state.history.map((item) => item.id)).size, 32);
    refresh();
    await actions.idle();
    assert.equal(state.historyHasMore, false);
  });
