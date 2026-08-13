/** Confirm words for Settings factory reset (either language, any case). */
const FACTORY_CONFIRM_WORDS = new Set(['factory', 'ضبط المصنع']);

export function isFactoryResetConfirmWord(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (FACTORY_CONFIRM_WORDS.has(normalized)) return true;
  return FACTORY_CONFIRM_WORDS.has(value.trim());
}
