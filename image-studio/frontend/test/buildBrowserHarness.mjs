// Builds an offline HTML harness; no network or API credentials are required.
import { build } from "esbuild";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] || "/tmp/xai-smoke.html");
const result = await build({ entryPoints: [resolve(root, "test/browserHarness.tsx")], write: false,
  bundle: true, format: "iife", platform: "browser", jsx: "automatic",
  loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl" },
  define: { "import.meta.env": JSON.stringify({ DEV: false, PROD: true, MODE: "production", VITE_TARGET_PLATFORM: "windows" }), "import.meta.hot": "undefined", "process.env.NODE_ENV": '"production"' } });
const assetRoot = resolve(root, "dist/assets");
const css = (await Promise.all((await readdir(assetRoot)).filter((name) => name.endsWith(".css")).map((name) => readFile(resolve(assetRoot, name), "utf8")))).join("\n");
const storage = `const map=new Map();const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear:()=>map.clear()};Object.defineProperty(window,"localStorage",{value:storage});Object.defineProperty(window,"sessionStorage",{value:storage});`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script>${storage}</script><!--FIXTURE--><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`);
console.log(output);
