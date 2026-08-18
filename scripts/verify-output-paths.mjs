import path from "node:path";

export function resolveVerifyOutputPath(singlePathEnvName, defaultFileName, env = process.env) {
  const explicit = (env[singlePathEnvName] || "").trim();
  if (explicit) return explicit;
  const rootDir = (env.IMAGE_STUDIO_VERIFY_RESULTS_DIR || "").trim();
  if (!rootDir) return "";
  return path.join(rootDir, defaultFileName);
}
