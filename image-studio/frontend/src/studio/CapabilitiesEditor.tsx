import type { Profile } from "./types";

type Capabilities = NonNullable<Profile["capabilities"]>;
type ModelRule = NonNullable<Capabilities["modelRules"]>[string];
type ModelCapabilities = NonNullable<ModelRule["images"]>;

function KnownFlag({ label, value, onChange }: {
  label: string; value?: boolean; onChange(value: boolean | undefined): void;
}) {
  return (
    <label>{label}
      <select value={value === undefined ? "unknown" : String(value)}
        onChange={(e) => onChange(e.target.value === "unknown" ? undefined : e.target.value === "true")}>
        <option value="unknown">未确认</option>
        <option value="true">已确认支持</option>
        <option value="false">已确认不支持</option>
      </select>
    </label>
  );
}

export function CapabilitiesEditor({ profile, onChange }: {
  profile: Profile; onChange(capabilities: Capabilities | undefined): void;
}) {
  const caps: Capabilities = profile.capabilities ?? { schemaVersion: 1 };
  const api = profile.imageApi === "responses" ? "responses" : "images";
  const model = profile.imageModel.trim();
  const rule: ModelCapabilities = caps.modelRules?.[model]?.[api] ?? {};
  const patch = (values: Partial<Capabilities>) => onChange({ ...caps, ...values });
  const patchRule = (values: Partial<ModelCapabilities>) => patch({
    modelRules: {
      ...caps.modelRules,
      [model]: { ...caps.modelRules?.[model], [api]: { ...rule, ...values } },
    },
  });
  const list = (field: "qualities" | "sizes" | "formats", label: string, placeholder: string) => (
    <label>{label}
      <input placeholder={placeholder} defaultValue={rule[field]?.join(", ") ?? ""}
        key={`${model}:${api}:${field}:${rule[field]?.join(",") ?? ""}`}
        onBlur={(e) => {
          const values = e.target.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
          patchRule({ [field]: values.length ? [...new Set(values)] : undefined });
        }} />
    </label>
  );
  return (
    <details className="studio-capability-editor">
      <summary>能力记录 · {profile.capabilities ? "已配置人工规则" : "尚未确认"}</summary>
      <p className="studio-muted">只记录当前提供商、精确模型和接口实测确认的能力。留空表示未知，不会因为选择预设或读取 /models 就认定支持；此处修改不会发送生成请求。</p>
      <div className="studio-form-row">
        {api === "images" ? (
          <>
            <KnownFlag label="Images 文生图" value={caps.images?.generate}
              onChange={(value) => patch({ images: { ...caps.images, generate: value } })} />
            <KnownFlag label="Images 参考图编辑" value={caps.images?.edit}
              onChange={(value) => patch({ images: { ...caps.images, edit: value } })} />
            <KnownFlag label="Images 流式返回" value={caps.images?.stream}
              onChange={(value) => patch({ images: { ...caps.images, stream: value } })} />
          </>
        ) : (
          <>
            <KnownFlag label="Responses 图片工具" value={caps.responses?.imageTool}
              onChange={(value) => patch({ responses: { ...caps.responses, imageTool: value } })} />
            <KnownFlag label="HTTP SSE" value={caps.responses?.sse}
              onChange={(value) => patch({ responses: { ...caps.responses, sse: value } })} />
            <KnownFlag label="WebSocket" value={caps.responses?.websocket}
              onChange={(value) => patch({ responses: { ...caps.responses, websocket: value } })} />
          </>
        )}
      </div>
      {model ? (
        <>
          <strong className="studio-capability-model">模型：{model} · {api === "images" ? "Images" : "Responses"}</strong>
          <div className="studio-form-row">
            {list("qualities", "已确认的质量档位", "例如 low, medium, high")}
            {list("sizes", "已确认的原生尺寸", "例如 1024x1024")}
            {list("formats", "已确认的文件格式", "例如 png, jpeg, webp")}
          </div>
          <div className="studio-form-row">
            <label>参考图数量上限
              <input type="number" min={0} max={16} value={rule.maxInputImages ?? ""} placeholder="未知"
                onChange={(e) => patchRule({ maxInputImages: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </label>
            <KnownFlag label="蒙版编辑" value={rule.supportsMask}
              onChange={(value) => patchRule({ supportsMask: value })} />
            <KnownFlag label="输入保真参数" value={rule.supportsInputFidelity}
              onChange={(value) => patchRule({ supportsInputFidelity: value })} />
          </div>
          {rule.supportsInputFidelity === true && <label>已确认的输入保真档位
            <input defaultValue={rule.inputFidelityValues?.join(", ") ?? ""}
              key={`${model}:${api}:fidelity:${rule.inputFidelityValues?.join(",") ?? ""}`}
              placeholder="例如 low, high"
              onBlur={(e) => {
                const values = e.target.value.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean);
                patchRule({ inputFidelityValues: values.length ? [...new Set(values)] : undefined });
              }} />
          </label>}
          <p className="studio-muted">未确认支持时不发送 input_fidelity；确认规则需精确到模型和协议。sub2api 的部分 Responses 路径会移除该字段，请以实际执行结果为准。</p>
        </>
      ) : <p className="studio-muted">先填写精确的图像模型 ID，再记录该模型的参数范围。</p>}
      <button type="button" className="studio-text-button" onClick={() => onChange(undefined)}>清除全部能力记录</button>
    </details>
  );
}
