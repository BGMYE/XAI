import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const previewUrl = process.env.IMAGE_STUDIO_PREVIEW_URL
  ?? "file:///Users/lin/Image-Studio/image-studio/frontend/dist-file-preview/index.html?preview=windows-right-rail&target=windows";
const fullPath = process.env.IMAGE_STUDIO_PREVIEW_FULL_PATH
  ?? "/Users/lin/Image-Studio/.tmp-windows-right-rail.png";
const studioPath = process.env.IMAGE_STUDIO_PREVIEW_STUDIO_PATH
  ?? "/Users/lin/Image-Studio/.tmp-windows-right-rail-studio.png";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {}

  const nodeBinDir = path.dirname(process.execPath);
  const bundledNodeModules = path.resolve(nodeBinDir, "..", "node_modules");
  const bundledEntry = path.join(bundledNodeModules, "playwright", "index.mjs");
  return import(pathToFileURL(bundledEntry).href);
}

function resolveExecutablePath(playwrightChromium) {
  const candidates = [
    path.join(
      "/Users/lin/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64",
      "chrome-headless-shell",
    ),
    path.join(
      "/Users/lin/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS",
      "Google Chrome for Testing",
    ),
    playwrightChromium.executablePath(),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No usable Playwright browser executable found. Tried: ${candidates.join(", ")}`);
}

const { chromium } = await loadPlaywright();
const executablePath = resolveExecutablePath(chromium);

const browser = await chromium.launch({
  headless: true,
  executablePath,
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1400 },
    deviceScaleFactor: 1,
  });
  await page.goto(previewUrl, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: fullPath, fullPage: true });
  const studio = page.locator(".studio");
  if (await studio.count()) {
    await studio.screenshot({ path: studioPath });
  }

  console.log(JSON.stringify({
    previewUrl,
    fullPath,
    studioPath,
    executablePath,
    cwd: projectRoot,
  }));
} finally {
  await browser.close();
}
