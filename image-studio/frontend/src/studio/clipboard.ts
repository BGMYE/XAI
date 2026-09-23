// Prefer the desktop clipboard; never claim success after a denied browser write.
export async function copyPromptText(text: string): Promise<void> {
  const native = (window as unknown as {runtime?: {ClipboardSetText?: (text: string) => Promise<boolean>}}).runtime;
  if (native?.ClipboardSetText) {
    if (await native.ClipboardSetText(text)) return;
    throw Error('系统剪贴板写入失败，请在详情中手动选择复制');
  }
  try {
    if (navigator.clipboard?.writeText) {await navigator.clipboard.writeText(text); return;}
  } catch { /* Old/embedded WebViews may still support the synchronous fallback. */ }
  const field = document.createElement('textarea');
  field.value = text; field.readOnly = true; field.style.cssText = 'position:fixed;left:-9999px;top:0;';
  const focused = document.activeElement as HTMLElement | null;
  // A modal dialog makes body children inert, so attach the fallback inside it.
  (document.querySelector('dialog[open]') ?? document.body).append(field);
  try {
    field.select(); field.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw Error('浏览器不允许复制，请在详情中手动选择完整提示词');
  } finally {field.remove(); focused?.focus();}
}
