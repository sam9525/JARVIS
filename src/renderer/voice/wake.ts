// Pure transcript maths, the way gestures.ts is pure landmark maths: no
// timers and no audio here. Segmentation belongs to segment.ts and the
// end-of-dictation clock belongs to use-voice-control.ts.
export const WAKE_WORD = "jarvis";

// How many wrong letters a word may carry and still wake. Whisper mis-hears
// "jarvis" routinely: an uncommon proper noun, spoken alone, with no
// surrounding words to disambiguate it. 2 admits "jervis" and "java's" and
// rejects "harvest" and "service". A false wake costs a deleted line, since
// nothing in this feature writes a carriage return.
const WAKE_DISTANCE = 2;

// Levenshtein over two short words, one row of the DP table. The result is
// never below the difference in the two lengths, so a length guard would
// reject nothing this does not: "jarvistown" is 4 away.
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

// `g` needs a fresh lastIndex per call, so build it per call rather than
// hoisting a shared stateful regex. Apostrophes are part of the token, so
// "java's" matches as one word; wakeIndex strips them before comparing.
const wordRe = () => /[A-Za-z']+/g;

/** Collapse every run of whitespace (spaces, tabs, `\r`, `\n`, ...) into a
 * single space and trim the ends. Whisper can join multi-segment output with
 * a mid-utterance `\r`/`\n`, and that string is written into a terminal
 * without a trailing carriage return (see use-voice-control.ts) — an
 * embedded newline would submit the prompt early, so every command this
 * module hands out must be a single line. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Index just past the LAST word close enough to be the wake word, or null.
 * Last, not first: saying it twice means you restarted the sentence, and the
 * newer one is the one you meant. */
export function wakeIndex(text: string): number | null {
  let end: number | null = null;
  for (const m of text.matchAll(wordRe())) {
    const word = m[0].toLowerCase().replace(/'/g, "");
    if (distance(word, WAKE_WORD) <= WAKE_DISTANCE) end = m.index + m[0].length;
  }
  return end;
}

/** Everything after the wake word, or null when that is empty. Whisper writes
 * "Jarvis," and "Jarvis -", so leading punctuation is stripped. */
export function commandAfterWake(text: string): string | null {
  const i = wakeIndex(text);
  if (i === null) return null;
  const rest = collapseWhitespace(text.slice(i).replace(/^[\s,.!?:;-]+/, ""));
  return rest || null;
}

/** A dictation in progress. `active` opens at the wake word and is closed by
 * the caller's silence clock, not by anything in this file. */
export type Dictation = { active: boolean; text: string };
export const NO_DICTATION: Dictation = { active: false, text: "" };

/** Fold one finished utterance in. Speech arrives in breaths, so the wake
 * word and the command are usually separate utterances — this is what lets
 * you pause and think without losing the dictation. */
export function feed(d: Dictation, utterance: string): Dictation {
  // a wake word always restarts: saying it again means the last attempt was
  // wrong, and appending to the false start would send both
  if (wakeIndex(utterance) !== null)
    return { active: true, text: commandAfterWake(utterance) ?? "" };
  if (!d.active) return d;
  const rest = collapseWhitespace(utterance);
  return rest
    ? { active: true, text: collapseWhitespace(`${d.text} ${rest}`) }
    : d;
}

/** The dictated command, or null when nothing but the wake word was said. */
export function finish(d: Dictation): string | null {
  if (!d.active) return null;
  return d.text.trim() || null;
}
