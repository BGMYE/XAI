// Shared by the studio controls and validation tests. Validation never changes
// the requested values; disabled processing intentionally ignores its settings.
export function defaultDLSS5Options() {
  return {
    enabled: false,
    style: 0,
    intensity: 1,
    localTone: 1,
    localStructure: 1,
    skinStructure: 1,
    outputMix: 1,
    autoMask: true,
    flowBackend: "off",
    flowWidth: 512,
    flowIterations: 6,
    previewResolution: { mode: "source", width: 1920, height: 1080 },
    exportResolution: { mode: "source", width: 1920, height: 1080 },
  };
}

function validateResolution(resolution, label, maximumEdge, maximumWidth, maximumHeight) {
  if (resolution?.mode === "source") return null;
  if (resolution?.mode !== "custom") return `${label}分辨率请选择原始尺寸或自定义尺寸。`;
  if (![resolution.width, resolution.height].every((edge) =>
    Number.isInteger(edge) && edge >= 128 && edge <= maximumEdge && edge % 2 === 0))
    return `${label}分辨率的宽高必须为 128～${maximumEdge} 范围内的偶数。`;
  if (resolution.width * resolution.height > maximumWidth * maximumHeight)
    return `${label}分辨率不得超过 ${maximumWidth}×${maximumHeight} 的总像素数。`;
  return null;
}

export function validateDLSS5Options(options) {
  if (options?.enabled === false) return null;
  if (options?.enabled !== true) return "请选择是否启用 DLSS 5 处理。";
  if (![0, 1, 2].includes(options.style)) return "风格需选择 0、1 或 2。";
  for (const [key, label] of [
    ["intensity", "总强度"],
    ["localTone", "局部色调"],
    ["localStructure", "局部结构"],
    ["skinStructure", "皮肤结构"],
    ["outputMix", "输出混合"],
  ]) {
    if (!Number.isFinite(options[key]) || options[key] < 0 || options[key] > 1)
      return `${label}需为 0～1（0～100%）之间的有效数值。`;
  }
  if (typeof options.autoMask !== "boolean") return "请选择是否启用自动蒙版。";
  if (!["off", "raft", "nvofa"].includes(options.flowBackend))
    return "光流后端请选择 off、raft 或 nvofa。";
  if (!Number.isInteger(options.flowWidth) || options.flowWidth < 128 || options.flowWidth > 2048)
    return "光流宽度必须为 128～2048 范围内的整数。";
  if (!Number.isInteger(options.flowIterations) || options.flowIterations < 1 || options.flowIterations > 32)
    return "光流迭代次数必须为 1～32 范围内的整数。";
  return validateResolution(options.previewResolution, "预览", 4096, 3840, 2160)
    ?? validateResolution(options.exportResolution, "导出", 8192, 7680, 4320);
}

export function validateDLSS5Clip(positionSeconds, durationSeconds) {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0)
    return "开始时间必须为大于或等于 0 的有效秒数。";
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 10)
    return "片段时长必须大于 0 且不超过 10 秒。";
  return null;
}

export function dlss5AspectRatio(width, height) {
  if (![width, height].every((edge) => Number.isSafeInteger(edge) && edge > 0)) return "—";
  let divisor = width;
  let remainder = height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  return `${width / divisor}:${height / divisor}`;
}

/** Keep video preferences in the form while excluding them from image requests. */
export function generationParameters(kind, parameters) {
  if (kind !== "image") return { ...parameters };
  const { dlss5: _videoEnhancement, ...imageParameters } = parameters;
  return imageParameters;
}
