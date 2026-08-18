const SAVE_PROMPT_SUPPRESSED_KEY = "gptcodex.savePromptSuppressed";

export function readSavePromptSuppressed(): boolean {
  try {
    return localStorage.getItem(SAVE_PROMPT_SUPPRESSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSavePromptSuppressed(value: boolean): void {
  try {
    if (value) localStorage.setItem(SAVE_PROMPT_SUPPRESSED_KEY, "1");
    else localStorage.removeItem(SAVE_PROMPT_SUPPRESSED_KEY);
  } catch {
    // localStorage can be unavailable in tests/previews.
  }
}

export function savePromptSuppressedStorageKey(): string {
  return SAVE_PROMPT_SUPPRESSED_KEY;
}
