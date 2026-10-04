import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "modal.tsx",
  readFileSync(new URL("../src/components/panel/UpstreamConfigModal.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functions = [];
let edit;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["toggleSavedKey", "changeDraftKey"].includes(node.name?.text))
    functions.push(node.getText(source));
  if (ts.isJsxAttribute(node) && node.name.getText(source) === "onChangeDraftKey")
    edit = node.initializer.expression.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const { outputText } = ts.transpileModule(
  `${functions.join("\n")} return { toggleSavedKey, edit: ${edit} };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
);
function actions(state, reveal) {
  const deps = {
    draftKey: state.key,
    showKey: state.show,
    draft: { id: "profile" },
    revealEpoch: state.epoch,
    revealedKey: state.revealed,
    setDraftKey: (key) => {
      state.key = key;
    },
    setShowKey: (show) => {
      state.show = show;
    },
    setSavedKeyLoaded: () => {},
    desktopRegistry: () => true,
    revealProfileKey: reveal,
    useStudioStore: { getState: () => ({ pushToast: assert.fail }) },
  };
  return Function(...Object.keys(deps), outputText)(...Object.values(deps));
}
test("typing a new key invalidates a pending saved-key reveal", async () => {
  const state = { key: "", show: false, epoch: { current: 1 }, revealed: { current: null } };
  let resolve;
  const a = actions(
    state,
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const reading = a.toggleSavedKey();
  a.edit("new-user-input");
  resolve("saved-old-key");
  await reading;
  assert.equal(state.key, "new-user-input");
  assert.equal(state.show, false);
});
test("hiding clears a revealed saved key but keeps a manually entered replacement", async () => {
  const state = { key: "", show: false, epoch: { current: 1 }, revealed: { current: null } };
  await actions(state, async () => "saved-key").toggleSavedKey();
  assert.equal(state.key, "saved-key");
  await actions(state).toggleSavedKey();
  assert.equal(state.key, "");
  actions(state).edit("replacement");
  await actions(state).toggleSavedKey();
  await actions(state).toggleSavedKey();
  assert.equal(state.key, "replacement");
});

test("hiding a revealed key invalidates another outstanding reveal", async () => {
  const state = { key: "", show: false, epoch: { current: 1 }, revealed: { current: null } };
  const pending = [];
  const reveal = () => new Promise((resolve) => pending.push(resolve));
  const first = actions(state, reveal).toggleSavedKey();
  const second = actions(state, reveal).toggleSavedKey();
  // Either request may finish first; the most recent request can be revealed.
  pending[1]("saved-key");
  await second;
  assert.equal(state.show, true);
  await actions(state, reveal).toggleSavedKey();
  pending[0]("saved-key");
  await first;
  assert.equal(state.key, "");
  assert.equal(state.show, false);
});
