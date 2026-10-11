import { openAIAPIEndpoint } from "../../../../../shared/kernel/requestModel.js";

export function EndpointPreview({ baseURL, protocol = "openai" }: { baseURL: string; protocol?: string }) {
  if (!baseURL.trim()) return null;
  try {
    new URL(baseURL);
  } catch {
    return null;
  }
  const endpoints =
    protocol === "xai"
      ? [
          ["图像", "images/generations"],
          ["视频", "videos/generations"],
        ]
      : [
          ["图像", "images/generations"],
          ["Responses", "responses"],
          ["视频", "videos"],
        ];
  return (
    <div
      className="endpoint-preview"
      style={{ fontSize: 11, lineHeight: 1.7, color: "var(--text-muted, #627a99)", overflowWrap: "anywhere" }}
      aria-label="实际请求地址"
    >
      {endpoints.map(([label, path]) => (
        <div key={label}>
          <span>{label}：</span>
          <code>{openAIAPIEndpoint(baseURL, path)}</code>
        </div>
      ))}
    </div>
  );
}
