import {
  base64ToBlob,
  blobToBase64,
  dataURLFromBase64,
  detectImageMimeTypeFromBase64,
  guessImageMimeTypeFromName,
  imageExtensionForMimeType,
} from "./images.ts";

type VirtualImageRecord = {
  path: string;
  name: string;
  size: number;
  imageB64: string;
  mimeType: string;
  createdAt: number;
  lastAccessedAt: number;
};

type VirtualTextRecord = {
  path: string;
  text: string;
  mimeType: string;
};

type ImportedImageRecord = {
  path: string;
  imageB64: string;
  mimeType?: string;
  name?: string;
};

type SelectedImageRecord = {
  path: string;
  size: number;
  imageB64?: string;
};

const VIRTUAL_IMAGE_PREFIX = "memory://image/";
const VIRTUAL_TEXT_PREFIX = "memory://text/";
const MAX_VIRTUAL_IMAGE_RECORDS = 24;
const MAX_VIRTUAL_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_VIRTUAL_TEXT_RECORDS = 24;

const virtualImages = new Map<string, VirtualImageRecord>();
const virtualTexts = new Map<string, VirtualTextRecord>();

function uniqueId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeName(name: string, fallbackBase: string): string {
  const trimmed = name.trim();
  if (!trimmed) return fallbackBase;
  return trimmed.replace(/[^\w.\-\u4e00-\u9fff]+/g, "-");
}

function base64SizeBytes(b64: string): number {
  const clean = b64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

function buildVirtualPath(prefix: string, name: string, mimeType: string): string {
  const stem = safeName(name, `image.${imageExtensionForMimeType(mimeType)}`);
  const ext = stem.includes(".") ? "" : `.${imageExtensionForMimeType(mimeType)}`;
  return `${prefix}${uniqueId("asset")}-${stem}${ext}`;
}

export function isVirtualPath(path: string | null | undefined): boolean {
  const value = (path ?? "").trim();
  return value.startsWith(VIRTUAL_IMAGE_PREFIX) || value.startsWith(VIRTUAL_TEXT_PREFIX);
}

export function getVirtualImageRecord(path: string): VirtualImageRecord | null {
  const record = virtualImages.get(path) ?? null;
  if (record) record.lastAccessedAt = Date.now();
  return record;
}

function virtualImageBytes(): number {
  let total = 0;
  for (const record of virtualImages.values()) total += record.size;
  return total;
}

function pruneVirtualImages(preservePath?: string) {
  if (virtualImages.size <= MAX_VIRTUAL_IMAGE_RECORDS && virtualImageBytes() <= MAX_VIRTUAL_IMAGE_BYTES) return;
  const candidates = Array.from(virtualImages.values())
    .filter((record) => record.path !== preservePath)
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.createdAt - b.createdAt);
  for (const record of candidates) {
    if (virtualImages.size <= MAX_VIRTUAL_IMAGE_RECORDS && virtualImageBytes() <= MAX_VIRTUAL_IMAGE_BYTES) break;
    virtualImages.delete(record.path);
  }
}

function pruneVirtualTexts() {
  if (virtualTexts.size <= MAX_VIRTUAL_TEXT_RECORDS) return;
  const dropCount = virtualTexts.size - MAX_VIRTUAL_TEXT_RECORDS;
  for (const path of Array.from(virtualTexts.keys()).slice(0, dropCount)) {
    virtualTexts.delete(path);
  }
}

export function releaseVirtualPath(path: string | null | undefined): void {
  if (!path) return;
  virtualImages.delete(path);
  virtualTexts.delete(path);
}

export function getVirtualHostMemoryStats(): { imageCount: number; imageBytes: number; textCount: number } {
  return {
    imageCount: virtualImages.size,
    imageBytes: virtualImageBytes(),
    textCount: virtualTexts.size,
  };
}

export function registerVirtualImage(input: {
  imageB64: string;
  suggestedName?: string;
  mimeType?: string | null;
  path?: string;
}): ImportedImageRecord {
  const mimeType = input.mimeType
    || detectImageMimeTypeFromBase64(input.imageB64)
    || guessImageMimeTypeFromName(input.suggestedName)
    || "image/png";
  const suggestedName = safeName(
    input.suggestedName ?? `image.${imageExtensionForMimeType(mimeType)}`,
    `image.${imageExtensionForMimeType(mimeType)}`,
  );
  const path = input.path && input.path.startsWith(VIRTUAL_IMAGE_PREFIX)
    ? input.path
    : buildVirtualPath(VIRTUAL_IMAGE_PREFIX, suggestedName, mimeType);
  virtualImages.set(path, {
    path,
    name: suggestedName,
    size: base64SizeBytes(input.imageB64),
    imageB64: input.imageB64,
    mimeType,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  });
  pruneVirtualImages(path);
  return { path, imageB64: input.imageB64, mimeType, name: suggestedName };
}

export function readVirtualImageAsBase64(path: string): string {
  const record = virtualImages.get(path);
  if (!record) throw new Error(`虚拟图片不存在:${path}`);
  record.lastAccessedAt = Date.now();
  return record.imageB64;
}

export function registerVirtualText(
  text: string,
  suggestedName = "raw-response.txt",
  mimeType = "text/plain;charset=utf-8",
): string {
  const path = buildVirtualPath(VIRTUAL_TEXT_PREFIX, suggestedName, "image/png").replace(/\.png$/, ".txt");
  virtualTexts.set(path, { path, text, mimeType });
  pruneVirtualTexts();
  return path;
}

export function readVirtualText(path: string): string {
  const record = virtualTexts.get(path);
  if (!record) throw new Error(`虚拟文本不存在:${path}`);
  return record.text;
}

export async function openVirtualPath(path: string): Promise<void> {
  const image = virtualImages.get(path);
  if (image) {
    const url = URL.createObjectURL(base64ToBlob(image.imageB64, image.mimeType));
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      const a = document.createElement("a");
      a.href = url;
      a.download = image.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
    return;
  }

  const text = virtualTexts.get(path);
  if (text) {
    const url = URL.createObjectURL(new Blob([text.text], { type: text.mimeType }));
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() || "raw-response.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
    return;
  }

  throw new Error(`虚拟资源不存在:${path}`);
}

export async function openImageDialogFallback(): Promise<SelectedImageRecord> {
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持浏览器文件选择");
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          resolve({ path: "", size: 0, imageB64: "" });
          return;
        }
        const imageB64 = await blobToBase64(file);
        const imported = registerVirtualImage({
          imageB64,
          suggestedName: file.name,
          mimeType: file.type || guessImageMimeTypeFromName(file.name) || "image/png",
        });
        cleanup();
        resolve({
          path: imported.path,
          size: file.size,
          imageB64,
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, { once: true });
    input.click();
  });
}

async function loadRecordBitmap(path: string): Promise<{ record: VirtualImageRecord; bitmap: ImageBitmap }> {
  const record = getVirtualImageRecord(path);
  if (!record) throw new Error(`虚拟图片不存在:${path}`);
  const bitmap = await createImageBitmap(base64ToBlob(record.imageB64, record.mimeType));
  return { record, bitmap };
}

async function canvasToRegisteredImage(
  canvas: HTMLCanvasElement,
  sourceRecord: VirtualImageRecord,
  suggestedName: string,
): Promise<ImportedImageRecord> {
  const preferredMime = sourceRecord.mimeType || "image/png";
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (out) => resolve(out ?? base64ToBlob(sourceRecord.imageB64, sourceRecord.mimeType)),
      preferredMime,
      preferredMime === "image/jpeg" ? 0.92 : undefined,
    );
  });
  disposeCanvas(canvas);
  const imageB64 = await blobToBase64(blob);
  return registerVirtualImage({
    imageB64,
    suggestedName,
    mimeType: blob.type || preferredMime,
  });
}

type GPUCanvas2DResult = {
  canvas: HTMLCanvasElement;
  acceleration: string;
  dispose: () => void;
};

function createWebGLCanvas(width: number, height: number): WebGLRenderingContext | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const webgl = canvas.getContext("webgl", {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (webgl) return webgl as WebGLRenderingContext;
  const experimental = canvas.getContext("experimental-webgl", {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  } as WebGLContextAttributes);
  return experimental as WebGLRenderingContext | null;
}

function disposeCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function disposeWebGLCanvas(gl: WebGLRenderingContext) {
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // ignore GPU cleanup failures
  }
  disposeCanvas(gl.canvas as HTMLCanvasElement);
}

let cachedWebGLImageTransformSupport: boolean | null = null;

export function canUseWebGLImageTransforms(): boolean {
  if (cachedWebGLImageTransformSupport !== null) return cachedWebGLImageTransformSupport;
  if (typeof document === "undefined") return false;
  try {
    const gl = createWebGLCanvas(1, 1);
    if (!gl) {
      cachedWebGLImageTransformSupport = false;
      return false;
    }
    disposeWebGLCanvas(gl);
    cachedWebGLImageTransformSupport = true;
    return true;
  } catch {
    cachedWebGLImageTransformSupport = false;
    return false;
  }
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建 WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(`WebGL shader 编译失败: ${message}`);
  }
  return shader;
}

function buildWebGLProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() {
      gl_FragColor = texture2D(u_texture, v_texCoord);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error("无法创建 WebGL program");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "unknown program link error";
    gl.deleteProgram(program);
    throw new Error(`WebGL program 链接失败: ${message}`);
  }
  return program;
}

function drawBitmapWithWebGL(
  bitmap: ImageBitmap,
  outWidth: number,
  outHeight: number,
  texCoords: Float32Array,
): GPUCanvas2DResult {
  const gl = createWebGLCanvas(outWidth, outHeight);
  if (!gl) {
    throw new Error("WebGL 不可用");
  }
  const canvas = gl.canvas as HTMLCanvasElement;
  let program: WebGLProgram | null = null;
  try {
    program = buildWebGLProgram(gl);
  } catch (error) {
    disposeWebGLCanvas(gl);
    throw error;
  }
  gl.viewport(0, 0, outWidth, outHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);

  const positionLoc = gl.getAttribLocation(program, "a_position");
  const texCoordLoc = gl.getAttribLocation(program, "a_texCoord");
  const textureLoc = gl.getUniformLocation(program, "u_texture");
  const positions = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]);

  const posBuffer = gl.createBuffer();
  const texBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  try {
    if (!posBuffer || !texBuffer || !texture || textureLoc == null) {
      throw new Error("WebGL 资源创建失败");
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.uniform1i(textureLoc, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();
    return { canvas, acceleration: "gpu-webgl", dispose: () => disposeWebGLCanvas(gl) };
  } catch (error) {
    disposeWebGLCanvas(gl);
    throw error;
  } finally {
    if (posBuffer) gl.deleteBuffer(posBuffer);
    if (texBuffer) gl.deleteBuffer(texBuffer);
    if (texture) gl.deleteTexture(texture);
    if (program) gl.deleteProgram(program);
  }
}

function noteGPUFallback(stage: string, error: unknown) {
  try {
    const target = globalThis as typeof globalThis & {
      __imageStudioGPUFallbacks?: Array<{ stage: string; message: string }>;
    };
    const message = String((error as any)?.message || error || "unknown");
    target.__imageStudioGPUFallbacks = target.__imageStudioGPUFallbacks || [];
    target.__imageStudioGPUFallbacks.push({ stage, message });
  } catch {
    // ignore diagnostics failures
  }
}

function rotateTexCoords(degrees: number): Float32Array {
  switch (((degrees % 360) + 360) % 360) {
    case 90:
      return new Float32Array([
        0, 0,
        0, 1,
        1, 0,
        1, 1,
      ]);
    case 180:
      return new Float32Array([
        1, 0,
        0, 0,
        1, 1,
        0, 1,
      ]);
    case 270:
      return new Float32Array([
        1, 1,
        1, 0,
        0, 1,
        0, 0,
      ]);
    default:
      return new Float32Array([
        0, 1,
        1, 1,
        0, 0,
        1, 0,
      ]);
  }
}

function flipTexCoords(horizontal: boolean): Float32Array {
  return horizontal
    ? new Float32Array([
        1, 1,
        0, 1,
        1, 0,
        0, 0,
      ])
    : new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
      ]);
}

function cropTexCoords(bitmap: ImageBitmap, left: number, top: number, width: number, height: number): Float32Array {
  const u0 = left / bitmap.width;
  const u1 = (left + width) / bitmap.width;
  const vTop = top / bitmap.height;
  const vBottom = (top + height) / bitmap.height;
  return new Float32Array([
    u0, vBottom,
    u1, vBottom,
    u0, vTop,
    u1, vTop,
  ]);
}

async function rotateBitmapWithGPU(bitmap: ImageBitmap, degrees: number): Promise<GPUCanvas2DResult> {
  const normalized = ((degrees % 360) + 360) % 360;
  const swap = normalized === 90 || normalized === 270;
  return drawBitmapWithWebGL(
    bitmap,
    swap ? bitmap.height : bitmap.width,
    swap ? bitmap.width : bitmap.height,
    rotateTexCoords(normalized),
  );
}

async function flipBitmapWithGPU(bitmap: ImageBitmap, horizontal: boolean): Promise<GPUCanvas2DResult> {
  return drawBitmapWithWebGL(bitmap, bitmap.width, bitmap.height, flipTexCoords(horizontal));
}

async function cropBitmapWithGPU(
  bitmap: ImageBitmap,
  left: number,
  top: number,
  width: number,
  height: number,
): Promise<GPUCanvas2DResult> {
  return drawBitmapWithWebGL(bitmap, width, height, cropTexCoords(bitmap, left, top, width, height));
}

export async function rotateVirtualImage(path: string, degrees: number): Promise<ImportedImageRecord & { acceleration?: string }> {
  const { record, bitmap } = await loadRecordBitmap(path);
  try {
    const normalized = ((degrees % 360) + 360) % 360;
    try {
      const rendered = await rotateBitmapWithGPU(bitmap, normalized);
      try {
        const result = await canvasToRegisteredImage(rendered.canvas, record, record.name);
        return { ...result, acceleration: rendered.acceleration };
      } finally {
        rendered.dispose();
      }
    } catch (error) {
      noteGPUFallback("rotate", error);
      const swap = normalized === 90 || normalized === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? bitmap.height : bitmap.width;
      canvas.height = swap ? bitmap.width : bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建图像画布");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((normalized * Math.PI) / 180);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      const result = await canvasToRegisteredImage(canvas, record, record.name);
      return { ...result, acceleration: "cpu-canvas" };
    }
  } finally {
    bitmap.close();
  }
}

export async function flipVirtualImage(path: string, horizontal: boolean): Promise<ImportedImageRecord & { acceleration?: string }> {
  const { record, bitmap } = await loadRecordBitmap(path);
  try {
    try {
      const rendered = await flipBitmapWithGPU(bitmap, horizontal);
      try {
        const result = await canvasToRegisteredImage(rendered.canvas, record, record.name);
        return { ...result, acceleration: rendered.acceleration };
      } finally {
        rendered.dispose();
      }
    } catch (error) {
      noteGPUFallback("flip", error);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建图像画布");
      ctx.translate(horizontal ? canvas.width : 0, horizontal ? 0 : canvas.height);
      ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
      ctx.drawImage(bitmap, 0, 0);
      const result = await canvasToRegisteredImage(canvas, record, record.name);
      return { ...result, acceleration: "cpu-canvas" };
    }
  } finally {
    bitmap.close();
  }
}

export async function cropVirtualImage(
  path: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<ImportedImageRecord & { acceleration?: string }> {
  const { record, bitmap } = await loadRecordBitmap(path);
  try {
    const left = Math.max(0, Math.min(bitmap.width, Math.round(x)));
    const top = Math.max(0, Math.min(bitmap.height, Math.round(y)));
    const cropWidth = Math.max(1, Math.min(bitmap.width - left, Math.round(width)));
    const cropHeight = Math.max(1, Math.min(bitmap.height - top, Math.round(height)));
    try {
      const rendered = await cropBitmapWithGPU(bitmap, left, top, cropWidth, cropHeight);
      try {
        const result = await canvasToRegisteredImage(rendered.canvas, record, record.name);
        return { ...result, acceleration: rendered.acceleration };
      } finally {
        rendered.dispose();
      }
    } catch (error) {
      noteGPUFallback("crop", error);
      const canvas = document.createElement("canvas");
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建图像画布");
      ctx.drawImage(bitmap, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const result = await canvasToRegisteredImage(canvas, record, record.name);
      return { ...result, acceleration: "cpu-canvas" };
    }
  } finally {
    bitmap.close();
  }
}

export async function sourceToDataURL(source: {
  path?: string;
  name?: string;
  mimeType?: string | null;
  imageB64?: string | null;
  imageBlob?: Blob | null;
} | null | undefined): Promise<string> {
  if (!source) return "";
  let imageB64 = source.imageB64?.trim() ?? "";
  let mimeType = source.mimeType
    || guessImageMimeTypeFromName(source.name)
    || guessImageMimeTypeFromName(source.path)
    || null;
  if (!imageB64 && source.imageBlob) {
    imageB64 = await blobToBase64(source.imageBlob);
    mimeType = source.imageBlob.type || mimeType;
  }
  if (!imageB64 && source.path && source.path.startsWith(VIRTUAL_IMAGE_PREFIX)) {
    const record = getVirtualImageRecord(source.path);
    if (record) {
      imageB64 = record.imageB64;
      mimeType = record.mimeType;
    }
  }
  if (!imageB64) return "";
  return dataURLFromBase64(imageB64, mimeType);
}
