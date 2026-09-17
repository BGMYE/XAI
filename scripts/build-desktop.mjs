import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(root, "image-studio");
const target = process.argv[2] ?? (process.platform === "win32" ? "windows" : process.platform);
const arch = process.argv[3] ?? (process.arch === "x64" ? "amd64" : process.arch);
if (!["windows", "linux", "darwin"].includes(target) || !["amd64", "arm64"].includes(arch)) {
  throw new Error("Usage: node scripts/build-desktop.mjs <windows|linux|darwin> <amd64|arm64>");
}
const metadata = JSON.parse(readFileSync(join(project, "wails.json"), "utf8"));
const version = process.env.VITE_APP_VERSION || metadata.info.productVersion;
const compiler = process.env.GO_COMPILER || "go";
const output = join(project, "build", "bin", `image-studio${target === "windows" ? ".exe" : ""}`);
mkdirSync(dirname(output), { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: project, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

const frontendTarget = target === "darwin" ? "macos" : target;
if (process.platform === "win32") {
  // frontendTarget is validated above; cmd is only used for npm's Windows launcher.
  run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm.cmd run build:${frontendTarget}`], { cwd: join(project, "frontend") });
} else {
  run("npm", ["run", `build:${frontendTarget}`], { cwd: join(project, "frontend") });
}

let resourcePath;
let resourceDirectory;
try {
  if (target === "windows") {
    resourcePath = join(project, `image_studio_resource_windows_${arch}.syso`);
    if (existsSync(resourcePath)) throw new Error(`A resource build is already present: ${resourcePath}`);
    resourceDirectory = mkdtempSync(join(project, "build", "bin", ".resources-"));
    const fields = { Name: metadata.name, ...Object.fromEntries(Object.entries(metadata.info).map(([key, value]) => [`Info.${key[0].toUpperCase()}${key.slice(1)}`, value])) };
    const substitute = (value) => value.replace(/\{\{\.(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
      if (!(key in fields)) throw new Error(`Unknown Windows resource field: ${key}`);
      return String(fields[key]);
    });
    const renderJSON = (value) => typeof value === "string" ? substitute(value)
      : Array.isArray(value) ? value.map(renderJSON)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, renderJSON(entry)])) : value;
    const info = renderJSON(JSON.parse(readFileSync(join(project, "build", "windows", "info.json"), "utf8")));
    const manifest = readFileSync(join(project, "build", "windows", "wails.exe.manifest"), "utf8").replace(/\{\{\.(\w+(?:\.\w+)*)\}\}/g, (_, key) => substitute(`{{.${key}}}`).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]));
    writeFileSync(join(resourceDirectory, "info.json"), JSON.stringify(info));
    writeFileSync(join(resourceDirectory, "app.manifest"), manifest);
    run(process.env.WAILS3_CLI || "wails3", ["generate", "syso", "-arch", arch, "-icon", join(project, "build", "windows", "icon.ico"), "-manifest", join(resourceDirectory, "app.manifest"), "-info", join(resourceDirectory, "info.json"), "-out", resourcePath]);
  }
  run(compiler, ["build", "-trimpath", "-buildvcs=false", "-tags", "production", "-ldflags", `-w -s ${target === "windows" ? "-H windowsgui " : ""}${target === "darwin" ? "-extldflags=-mmacosx-version-min=12.0 " : ""}-X github.com/yuanhua/image-gptcodex/pkg/client.Version=${version}`, "-o", output, "."], {
    env: { ...process.env, GOOS: target, GOARCH: arch, CGO_ENABLED: target === "windows" ? "0" : "1", ...(target === "darwin" ? { MACOSX_DEPLOYMENT_TARGET: "12.0" } : {}) },
  });
  console.log(output);
} finally {
  if (resourceDirectory) {
    if (resourcePath) rmSync(resourcePath, { force: true });
    rmSync(resourceDirectory, { recursive: true, force: true });
  }
}
