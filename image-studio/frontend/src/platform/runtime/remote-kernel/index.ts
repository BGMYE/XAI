import {
  DEFAULT_AUTO_RETRY_COUNT,
  MAX_AUTO_RETRY_COUNT,
  MAX_ATTEMPTS,
  buildPromptOptimizePayload,
  fileNameFromPath,
  normalizeAPIMode,
  openAIAPIEndpoint,
} from "../../../../../../shared/kernel/requestModel.js";
import {
  extractResponseErrorMessage,
  extractResponseText,
  shouldUseAndroidNativeHTTP,
  sourceToDataURL,
  validateRemoteBaseURL,
} from "./common.ts";
import { nativeHttpRequestText } from "./nativeHttp.ts";
import { requestImagesOnce } from "./images.ts";
import { requestResponsesOnce } from "./responses.ts";
import {
  RETRY_BACKOFF_MS,
  RemoteKernelError,
  type RemotePromptOptimizeInput,
  type RemoteJobCallbacks,
  type RemoteJobRequest,
  type RemoteJobResult,
} from "./types.ts";

export * from "./types.ts";

export async function runRemoteImageJob(
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
): Promise<RemoteJobResult> {
  validateRemoteBaseURL(request.payload.baseURL, request.payload.allowInsecureConnection === true);
  if (request.payload.allowInsecureConnection && !shouldUseAndroidNativeHTTP()) {
    throw new RemoteKernelError("允许不安全连接需要桌面本地内核或 Android 原生内核；浏览器不能绕过 HTTPS 证书校验");
  }
  // Image generation is a billable side effect. A timeout, partial-only stream,
  // or provider error cannot establish that submission did not happen. Let the
  // user review the outcome before explicitly trying again or switching hosts.
  try {
    return normalizeAPIMode(request.payload.apiMode) === "images"
      ? await requestImagesOnce(request, 1, 1, callbacks)
      : await requestResponsesOnce(request, 1, 1, callbacks);
  } catch (error) {
    if (callbacks.signal.aborted) throw error;
    callbacks.onLog?.("请求没有自动重发或切换上游；如连接中断，请先核对上游任务与费用，再手动重试。");
    throw error instanceof RemoteKernelError
      ? error
      : new RemoteKernelError(String((error as any)?.message || error));
  }
}

export async function optimizePromptRemote(
  input: RemotePromptOptimizeInput,
  signal: AbortSignal,
): Promise<string> {
  validateRemoteBaseURL(input.baseURL, input.allowInsecureConnection === true);
  if (input.allowInsecureConnection && !shouldUseAndroidNativeHTTP()) {
    throw new RemoteKernelError("允许不安全连接需要桌面本地内核或 Android 原生内核；浏览器不能绕过 HTTPS 证书校验");
  }
  const mergedSources = input.sourceImages?.length
    ? input.sourceImages
    : [
        ...(input.imagePaths ?? []).map((path) => ({ path, name: fileNameFromPath(path) })),
        ...(input.imagePath ? [{ path: input.imagePath, name: fileNameFromPath(input.imagePath) }] : []),
      ];
  const sourceDataURLs: string[] = [];
  for (const source of mergedSources) {
    const dataURL = await sourceToDataURL(source);
    if (dataURL) sourceDataURLs.push(dataURL);
  }
  const url = openAIAPIEndpoint(input.baseURL, "responses");
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const body = JSON.stringify(buildPromptOptimizePayload(input, sourceDataURLs));
  const proxyMode = input.proxyMode === "none" || input.proxyMode === "custom" ? input.proxyMode : "system";
  const response = shouldUseAndroidNativeHTTP()
    ? await nativeHttpRequestText(url, "POST", headers, body, signal, undefined, {
        proxyMode,
        proxyURL: input.proxyURL || "",
        allowInsecureConnection: input.allowInsecureConnection === true,
      })
    : {
        status: 0,
        body: "",
      };
  const raw = shouldUseAndroidNativeHTTP()
    ? response.body
    : await (async () => {
        if (proxyMode !== "system") {
          throw new RemoteKernelError("当前远程内核不能控制代理,请切回本地内核或使用 Android 原生运行");
        }
        const webResponse = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal,
        });
        const text = await webResponse.text();
        response.status = webResponse.status;
        return text;
      })();
  if (response.status < 200 || response.status >= 300) {
    throw new RemoteKernelError(`上游返回 ${response.status}:${extractResponseErrorMessage(raw)}`);
  }
  const text = extractResponseText(raw);
  if (!text) {
    throw new RemoteKernelError("上游没有返回可用的优化结果");
  }
  return text;
}

export {
  DEFAULT_AUTO_RETRY_COUNT,
  MAX_ATTEMPTS,
  MAX_AUTO_RETRY_COUNT,
  RETRY_BACKOFF_MS,
};
