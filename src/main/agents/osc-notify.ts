export const OSC_BUFFER_CAP = 256;

const ESC = "\x1b";
const BEL = "\x07";
const INTRODUCER = `${ESC}]9;`;

/**
 * Finds `ESC ] 9 ; <text>` notification sequences, ended by BEL or `ESC \`, in a terminal
 * output stream. `feed` returns the texts completed by a chunk; `key` names the stream, so
 * a sequence split across chunks is joined only with its own stream.
 */
export function createOscScanner(): {
  feed(key: string, chunk: string): string[];
  forget(key: string): void;
} {
  const unfinishedByKey = new Map<string, string>();

  return {
    feed(key, chunk) {
      const data = (unfinishedByKey.get(key) ?? "") + chunk;
      const texts: string[] = [];
      let unfinished = "";
      let at = data.indexOf(ESC);

      while (at !== -1) {
        if (!data.startsWith(INTRODUCER, at)) {
          const rest = data.length - at;
          if (
            rest < INTRODUCER.length &&
            INTRODUCER.startsWith(data.slice(at))
          ) {
            unfinished = data.slice(at);
            break;
          }
          at = data.indexOf(ESC, at + 1);
          continue;
        }

        const textStart = at + INTRODUCER.length;
        const bel = data.indexOf(BEL, textStart);
        const esc = data.indexOf(ESC, textStart);

        if (bel !== -1 && (esc === -1 || bel < esc)) {
          texts.push(data.slice(textStart, bel));
          at = data.indexOf(ESC, bel + 1);
        } else if (esc === -1 || esc === data.length - 1) {
          unfinished = data.slice(at);
          break;
        } else if (data[esc + 1] === "\\") {
          texts.push(data.slice(textStart, esc));
          at = data.indexOf(ESC, esc + 2);
        } else {
          // Any other ESC aborts the sequence and may start a new one.
          at = esc;
        }
      }

      if (unfinished !== "" && unfinished.length <= OSC_BUFFER_CAP) {
        unfinishedByKey.set(key, unfinished);
      } else {
        unfinishedByKey.delete(key);
      }
      return texts;
    },

    forget(key) {
      unfinishedByKey.delete(key);
    },
  };
}
