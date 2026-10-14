/**
 * 20-14-1: the "when ... is played" inside this prohibition names the taxed
 * act, not another Auto trigger (BT31-093, BT31-150). Share the wording with
 * effect compilation so drafting the WHEN and the program cannot disagree.
 */
export function playTaxWording(text: string): string {
  return text.replace(
    /\bwhen (your opponent's|your) (.+?) (?:is|are) played, (?:your opponent|they|you) can(?:'|no)t play (?:it|them) unless\b/gi,
    (_m, whose: string, what: string) => `${/opponent/i.test(whose) ? "your opponent" : "you"} can't play ${what} unless`,
  );
}
