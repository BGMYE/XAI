// Offline UI integration harness. This entry is never imported by production.
// It replaces only the desktop transport/persistence boundary, not UI state logic.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../src/app/App";
import { PlatformProvider } from "../src/platform/context";
import { applyPlatformAttributes } from "../src/platform";
import { useStudioStore } from "../src/state/studioStore";
import { useStudioV2, refreshStudioTasks, flushStudioDocument } from "../src/state/studioV2";
import type { StudioDocument, StudioTask } from "../src/lib/studioDocuments";

const host = window as any;
const seed = host.__seed || {};
let document: StudioDocument = seed.document || { version: 1, revision: 0, activeWorkspaceId: "", workspaces: [], appliedVideoTaskIds: [] };
let tasks: StudioTask[] = seed.tasks || [];
let conflict = false;
let submits = 0;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const service = {
  Generate: () => { throw new Error("Image upstream deliberately excluded from offline UI tests"); },
  GetStoredAPIKey: () => "smoke-test-key",
  LoadCanvasDocument: () => copy(document),
  SaveCanvasDocument: (next: StudioDocument, revision: number) => {
    if (conflict || document.revision !== revision) throw new Error("CANVAS_CONFLICT: concurrent edit");
    document = copy({ ...next, revision: revision + 1 }); return copy(document);
  },
  ListTasks: () => copy(tasks),
  SubmitVideoTask: (options: any) => {
    submits++;
    const task: StudioTask = { id: options.requestedJobId, queue: "video", kind: "video", status: "running",
      revision: 1, createdAt: Date.now(), updatedAt: Date.now(), workspaceId: options.workspaceId,
      profileId: options.profileId, provider: options.provider, modelId: options.videoModelID,
      baseURL: options.baseURL, label: options.prompt, remoteId: "mock-remote-1" };
    tasks.push(task); return copy(task);
  },
  Cancel: (id: string) => { tasks = tasks.map((task) => task.id === id ? { ...task, status: "cancelled", revision: task.revision + 1 } : task); },
  RegisterVideoAsset: () => "/media/full/1234567890abcdef1234567890abcdef",
  RegisterMediaAsset: () => ({ fullUrl: seed.image || "", previewUrl: seed.image || "" }),
  RegisterImportedImageAsset: () => ({ fullUrl: seed.image || "", previewUrl: seed.image || "" }),
};
host.go = { backend: { Service: service } };
host.runtime = { EventsOnMultiple: () => () => {}, EventsOff: () => {} };
useStudioStore.setState({ bootstrap: async () => {
  const store = useStudioStore.getState(); store.newWorkspace("未命名画布");
  const profile = { ...(store.profiles[0] || {}), id: "smoke-profile", name: "测试上游", baseURL: "https://api.example.test/v1",
    videoModelID: "test-video-model", imageModelID: "test-image-model", textModelID: "test-text-model", apiMode: "images" as const };
  useStudioStore.setState({ profiles: [profile as any], activeProfileId: profile.id, apiKey: "smoke-test-key",
    baseURL: profile.baseURL, imageModelID: profile.imageModelID, textModelID: profile.textModelID,
    history: seed.history || [], settingsOpen: false });
} });
host.__studioSmoke = {
  ready: () => useStudioV2.getState().ready,
  store: () => useStudioStore.getState(), runtime: () => useStudioV2.getState(),
  snapshot: () => ({ document: copy(document), tasks: copy(tasks), submits }),
  complete: async () => {
    tasks = tasks.map((task) => ({ ...task, status: "succeeded", revision: task.revision + 1,
      result: { savedPath: "/test/output/videos/mock.mp4", mediaUrl: service.RegisterVideoAsset(), width: 1280, height: 720 } }));
    await refreshStudioTasks(); await flushStudioDocument();
  },
  refresh: refreshStudioTasks, flush: flushStudioDocument,
  setConflict: () => { conflict = true; },
};
applyPlatformAttributes();
createRoot(window.document.getElementById("root")!).render(<React.StrictMode><PlatformProvider><App /></PlatformProvider></React.StrictMode>);
