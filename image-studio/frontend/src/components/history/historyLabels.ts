export function qualityLabel(raw: string): string {
  switch (raw) {
    case "low":
      return "快速";
    case "medium":
      return "标准";
    case "high":
      return "精修";
    case "standard":
      return "standard";
    case "hd":
      return "hd";
    case "auto":
      return "自动";
    default:
      return raw;
  }
}

export function sizeLabel(raw: string): string {
  switch (raw) {
    case "256x256":
      return "1:1 · 256";
    case "512x512":
      return "1:1 · 512";
    case "1024x1024":
      return "1:1 · 1K";
    case "1536x1024":
      return "3:2 · 1K";
    case "1024x1536":
      return "2:3 · 1K";
    case "1536x864":
      return "16:9 · 1K";
    case "864x1536":
      return "9:16 · 1K";
    case "1792x1024":
      return "7:4 · 1K";
    case "1024x1792":
      return "4:7 · 1K";
    case "2048x2048":
      return "1:1 · 2K";
    case "2048x1360":
      return "3:2 · 2K";
    case "1360x2048":
      return "2:3 · 2K";
    case "2048x1152":
      return "16:9 · 2K";
    case "1152x2048":
      return "9:16 · 2K";
    case "2880x2880":
      return "1:1 · 4K";
    case "3456x2304":
      return "3:2 · 4K";
    case "2304x3456":
      return "2:3 · 4K";
    case "3840x2160":
      return "16:9 · 4K";
    case "2160x3840":
      return "9:16 · 4K";
    case "auto":
      return "自动";
    default:
      if (/^\d+x\d+$/.test(raw)) {
        return raw.replace("x", "×");
      }
      return raw;
  }
}
