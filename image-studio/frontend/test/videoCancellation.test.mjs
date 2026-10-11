import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("panel.tsx", readFileSync(new URL("../src/components/panel/VideoGenerationPanel.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["submitVideo", "cancelPolling", "cancelVideoJob", "errorText"].includes(node.name?.text)) functions.push(node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
const { outputText } = ts.transpileModule(`${functions.join("\n")} return { submitVideo, cancelPolling };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });

function panel() {
  const state = { status: "", error: "", cancelled: [], polled: [] };
  const creates = [];
  const deps = {
    runRef: { current: 0 }, timerRef: { current: null }, abortRef: { current: null }, activeVideoRef: { current: null },
    setRunning() {}, setStatus: (value) => { state.status = value; }, setError: (value) => { state.error = value; }, setVideoURL() {},
    useStudioStore: { getState: () => ({ activeWorkspaceId: "workspace" }) },
    activeProfile: { baseURL: "https://example.com" }, activeProfileId: "profile", apiKey: "", prompt: "ocean", seconds: 4, size: "1280x720",
    profileHasKey: () => true, desktopRegistry: () => true, requireExplicitVideoModelID: () => "video-model",
    CreateVideo: () => new Promise((resolve) => creates.push(resolve)),
    Cancel: async (id) => { state.cancelled.push(id); if (state.cancelError) throw new Error(state.cancelError); },
    finishOrPoll: async (result, _id, runID) => { if (deps.runRef.current === runID) state.polled.push(result.id); },
  };
  return { ...Function(...Object.keys(deps), outputText)(...Object.values(deps)), state, creates };
}

test("stopping classic video cancels its shared task", async () => {
  const view = panel();
  const submitted = view.submitVideo();
  view.creates[0]({ id: "job-1", status: "queued" });
  await submitted;
  await view.cancelPolling();
  assert.deepEqual(view.state.cancelled, ["job-1"]);
});

test("stopping before create returns cancels the late task without polling it", async () => {
  const view = panel();
  const submitted = view.submitVideo();
  await view.cancelPolling();
  view.creates[0]({ id: "late-job", status: "queued" });
  await submitted;
  assert.deepEqual(view.state.cancelled, ["late-job"]);
  assert.deepEqual(view.state.polled, []);
});

test("a late cancelled task does not overwrite a newer video run", async () => {
  const view = panel();
  const first = view.submitVideo();
  await view.cancelPolling();
  const second = view.submitVideo();
  const status = view.state.status;
  view.creates[0]({ id: "old-job", status: "queued" });
  await first;
  assert.equal(view.state.status, status);
  view.creates[1]({ id: "new-job", status: "queued" });
  await second;
  assert.deepEqual(view.state.cancelled, ["old-job"]);
  assert.deepEqual(view.state.polled, ["new-job"]);
});

test("backend cancellation failure is visible", async () => {
  const view = panel();
  const submitted = view.submitVideo();
  view.creates[0]({ id: "job", status: "queued" });
  await submitted;
  view.state.cancelError = "storage unavailable";
  await view.cancelPolling();
  assert.match(view.state.error, /storage unavailable/);
});
