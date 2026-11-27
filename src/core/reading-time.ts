/**
 * Reading-time estimation (pure function).
 *
 * CJK at 400 chars/min, English at 200 words/min; mixed text adds the two.
 * Anything under a minute displays as 1 minute — "0 min" is meaningless for a freshly written draft.
 */

export function readingMinutes(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const words = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  const minutes = cjk / 400 + words / 200;
  return Math.max(1, Math.ceil(minutes));
}
