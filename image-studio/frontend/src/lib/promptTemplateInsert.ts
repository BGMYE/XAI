export function appendPromptTemplateText(currentPrompt: string, templateText: string): string {
  const current = String(currentPrompt || "").trim();
  const addition = String(templateText || "").trim();
  if (!addition) return currentPrompt;
  return current ? `${current}, ${addition}` : addition;
}
