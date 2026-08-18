import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { resolveVerifyOutputPath } from "./verify-output-paths.mjs";

const root = process.cwd();
const androidRoot = `${root}/android-shell`;
const androidSdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || `${root}/.tmp/android-sdk`;
const javaHome = process.env.IMAGE_STUDIO_JAVA_HOME || process.env.JAVA_HOME || `${root}/.tmp/jdk/jdk-17.0.19+10/Contents/Home`;
const gradleUserHome = process.env.GRADLE_USER_HOME || `${root}/.tmp/gradle-home-arm64`;
const androidUserHome = process.env.ANDROID_USER_HOME || `${root}/.tmp/android-home/.android`;
const homeDir = process.env.HOME || `${root}/.tmp/android-home`;
const buildToolsDir = `${androidSdkRoot}/build-tools/34.0.0`;
const apkPath = `${androidRoot}/app/build/outputs/apk/debug/app-debug.apk`;
const outputMetadataPath = `${androidRoot}/app/build/outputs/apk/debug/output-metadata.json`;
const localPropertiesPath = `${androidRoot}/local.properties`;
const androidVersionName = process.env.IMAGE_STUDIO_ANDROID_VERSION_NAME || "0.1.5-dev";
const androidVersionCode = Number(process.env.IMAGE_STUDIO_ANDROID_VERSION_CODE || "1050001");
const toolEnv = {
  JAVA_HOME: javaHome,
  PATH: `${javaHome}/bin:${process.env.PATH ?? ""}`,
};
const deviceSmokeEnabled = /^(1|true)$/i.test(process.env.IMAGE_STUDIO_ANDROID_DEVICE_SMOKE ?? "");
const requestedSerial = (process.env.IMAGE_STUDIO_ANDROID_SERIAL || "").trim();
const outputPath = resolveVerifyOutputPath("IMAGE_STUDIO_ANDROID_VERIFY_OUTPUT_PATH", "android-shell.json");
const summary = {
  startedAt: new Date().toISOString(),
  status: "running",
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    androidSdkRoot,
    javaHome,
    androidUserHome,
    gradleUserHome,
    androidVersionName,
    androidVersionCode,
    deviceSmokeEnabled,
    requestedSerial: requestedSerial || null,
  },
};

async function resolveAdbPath() {
  const bundled = `${androidSdkRoot}/platform-tools/adb`;
  try {
    await access(bundled, fsConstants.X_OK);
    return bundled;
  } catch {
    return "adb";
  }
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? 1}\n${stderr || stdout}`));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeOutputIfRequested(payload) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureLocalProperties() {
  await writeFile(localPropertiesPath, `sdk.dir=${androidSdkRoot}\n`, "utf8");
}

const gradleEnv = {
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidSdkRoot,
  ANDROID_SDK_ROOT: androidSdkRoot,
  ANDROID_USER_HOME: androidUserHome,
  HOME: homeDir,
  GRADLE_USER_HOME: gradleUserHome,
  IMAGE_STUDIO_ANDROID_VERSION_NAME: androidVersionName,
  IMAGE_STUDIO_ANDROID_VERSION_CODE: String(androidVersionCode),
};

async function verifyOutputMetadata() {
  const metadata = JSON.parse(await readFile(outputMetadataPath, "utf8"));
  assert(metadata.applicationId === "top.gptcodex.imagestudio.android.debug", `unexpected applicationId: ${metadata.applicationId}`);
  const element = metadata.elements?.[0];
  assert(element, "output-metadata.json missing elements[0]");
  assert(element.versionCode === androidVersionCode, `unexpected versionCode: ${element.versionCode}`);
  assert(element.versionName === `${androidVersionName}-debug`, `unexpected versionName: ${element.versionName}`);
  return {
    applicationId: metadata.applicationId,
    versionCode: element.versionCode,
    versionName: element.versionName,
  };
}

async function verifyBadging() {
  const { stdout } = await run(`${buildToolsDir}/aapt`, ["dump", "badging", apkPath], { env: toolEnv });
  assert(stdout.includes("name='top.gptcodex.imagestudio.android.debug'"), "aapt badging missing debug application id");
  assert(stdout.includes(`versionCode='${androidVersionCode}'`), "aapt badging missing expected versionCode");
  assert(stdout.includes(`versionName='${androidVersionName}-debug'`), "aapt badging missing expected versionName");
  return stdout;
}

async function verifyApkSignature() {
  const { stdout, stderr } = await run(`${buildToolsDir}/apksigner`, ["verify", "-v", apkPath], { env: toolEnv });
  return (stdout + stderr).trim() || "verified";
}

async function verifyEmbeddedFrontendAssets() {
  const listing = (await run("unzip", ["-l", apkPath])).stdout;
  assert(listing.includes("assets/index.html"), "APK missing assets/index.html");
  assert(/assets\/assets\/platform-ui-.*\.js/.test(listing), "APK missing built platform-ui asset");
  assert(/assets\/assets\/AppUpdateModal-.*\.js/.test(listing), "APK missing lazily built AppUpdateModal asset");
  const indexHtml = (await run("unzip", ["-p", apkPath, "assets/index.html"])).stdout;
  assert(/<div id="root"><\/div>|<div id=\"root\"><\/div>/.test(indexHtml), "embedded index.html does not look like frontend entry");
  return true;
}

async function listAdbDevices(adbPath) {
  const { stdout } = await run(adbPath, ["devices"]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices attached"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);
}

async function runOptionalDeviceSmoke() {
  if (!deviceSmokeEnabled) {
    return { attempted: false, reason: "IMAGE_STUDIO_ANDROID_DEVICE_SMOKE not set" };
  }
  const adbPath = await resolveAdbPath();
  const devices = await listAdbDevices(adbPath);
  if (devices.length === 0) {
    return { attempted: false, reason: "no adb device attached" };
  }
  const serial = requestedSerial || devices[0];
  if (!devices.includes(serial)) {
    return { attempted: false, reason: `requested serial not found: ${serial}` };
  }
  await run(adbPath, ["-s", serial, "install", "-r", apkPath]);
  const component = "top.gptcodex.imagestudio.android.debug/top.gptcodex.imagestudio.android.MainActivity";
  const start = await run(adbPath, ["-s", serial, "shell", "am", "start", "-n", component]);
  const pid = (await run(adbPath, ["-s", serial, "shell", "pidof", "top.gptcodex.imagestudio.android.debug"])).stdout.trim();
  assert(pid, "device smoke launched activity but process pid was empty");
  return {
    attempted: true,
    serial,
    component,
    pid,
    startOutput: start.stdout.trim(),
  };
}

let capturedError = null;
try {
  await ensureLocalProperties();
  summary.localPropertiesPrepared = true;

  await run("./gradlew", [":app:testDebugUnitTest"], {
    cwd: androidRoot,
    env: gradleEnv,
  });
  summary.unitTests = true;

  await run("./gradlew", [":app:assembleDebug"], {
    cwd: androidRoot,
    env: gradleEnv,
  });
  summary.assembleDebug = true;
  summary.apkPath = apkPath;

  const metadata = await verifyOutputMetadata();
  const badging = await verifyBadging();
  const signature = await verifyApkSignature();
  const assetsVerified = await verifyEmbeddedFrontendAssets();
  const deviceSmoke = await runOptionalDeviceSmoke();

  summary.metadata = metadata;
  summary.assetsVerified = assetsVerified;
  summary.signature = signature;
  summary.deviceSmoke = deviceSmoke;
  summary.badging = badging.split("\n").slice(0, 6);
  summary.status = "passed";
  summary.completedAt = new Date().toISOString();
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  capturedError = error;
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = error?.message ?? String(error);
} finally {
  await writeOutputIfRequested(summary).catch(() => undefined);
  if (capturedError) throw capturedError;
}
