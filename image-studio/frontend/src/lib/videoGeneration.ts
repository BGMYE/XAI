export type VideoPollingOutcome = "pending" | "completed" | "failed" | "cancelled";

export function videoPollingDecision(status: string): { terminal: boolean; outcome: VideoPollingOutcome } {
  const normalized = status.trim().toLowerCase();
  if (normalized === "completed") return { terminal: true, outcome: "completed" };
  if (normalized === "failed") return { terminal: true, outcome: "failed" };
  if (normalized === "cancelled" || normalized === "canceled") return { terminal: true, outcome: "cancelled" };
  return { terminal: false, outcome: "pending" };
}

export function requireExplicitVideoModelID(profile: { videoModelID?: string }): string {
  const videoModelID = profile.videoModelID?.trim() ?? "";
  if (!videoModelID) {
    throw new Error("请先在当前上游配置中填写视频模型 ID");
  }
  return videoModelID;
}

export function cancellableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(done, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    function done() { signal.removeEventListener("abort", onAbort); resolve(); }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function videoResultError(result: { error?: string; status?: string }): string {
  return result.error || result.status || "视频生成失败";
}

export function videoResultSource(result: { url?: string; b64_json?: string }): string {
  const directURL = result.url?.trim();
  if (directURL) {
    try {
      const parsed = new URL(directURL);
      if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password) {
        return directURL;
      }
    } catch {
      // Provider media URLs must be absolute. Do not guess a base URL here.
    }
  }
  const encoded = result.b64_json?.trim();
  return encoded ? `data:video/mp4;base64,${encoded}` : "";
}
