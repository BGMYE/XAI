import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const desktopURL = new URL("../src/platform/runtime/desktop.ts", import.meta.url).href;
const handlers = new Map();
globalThis.__desktopEditRuntime = {
  Events: { On: (name, callback) => { handlers.set(name, callback); return () => handlers.delete(name); } },
  Call: { ByName() {} }, Window: {}, Application: {},
};
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === desktopURL && specifier === "@wailsio/runtime") return { url: "desktop-edit:runtime", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "desktop-edit:runtime") return { format: "module", shortCircuit: true, source: "export const { Events, Call, Window, Application } = globalThis.__desktopEditRuntime;" };
    return nextLoad(url, context);
  },
});

test("native Edit commands preserve focused text editing and otherwise dispatch one canvas action", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const textCommands = [], canvasCommands = [];
  try {
    globalThis.window = Object.assign(new EventTarget(), { location: { hostname: "wails.localhost", protocol: "http:" } });
    globalThis.document = {
      activeElement: { matches: () => true, isContentEditable: false },
      execCommand: (command) => textCommands.push(command),
    };
    window.addEventListener("studio:edit-command", (event) => canvasCommands.push(event.detail.command));
    const { installDesktopRuntime } = await import(desktopURL);
    await installDesktopRuntime();
    const dispatch = handlers.get("desktop-edit-command");
    dispatch({ data: { command: "undo" } });
    assert.deepEqual(textCommands, ["undo"]);
    assert.deepEqual(canvasCommands, []);
    document.activeElement = { matches: () => false, isContentEditable: false };
    dispatch({ data: { command: "redo" } });
    dispatch({ data: { command: "not-an-edit-command" } });
    assert.deepEqual(textCommands, ["undo"]);
    assert.deepEqual(canvasCommands, ["redo"]);
    document.activeElement = { matches: () => false, isContentEditable: true };
    dispatch({ data: { command: "redo" } });
    assert.deepEqual(textCommands, ["undo", "redo"]);
    assert.deepEqual(canvasCommands, ["redo"]);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    delete globalThis.__desktopEditRuntime;
    loader.deregister();
  }
});
