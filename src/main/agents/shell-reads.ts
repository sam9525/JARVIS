export interface ShellActivity {
  reads: string[];
  searches: string[];
}

// ponytail: first-word parser, best effort by design; a real shell tokenizer if reads go missing in daily use
const READERS = new Set(
  "cat type get-content gc head tail sed nl less more bat".split(" "),
);
const SEARCHERS = new Set(
  "rg grep select-string sls findstr fd find get-childitem ls dir".split(" "),
);
const FOLDER_CHANGERS = new Set(["cd", "chdir", "pushd", "set-location", "sl"]);
const SHELLS = new Set(["powershell", "pwsh", "bash", "sh", "cmd"]);
const COMMAND_FLAGS = new Set(["-command", "-c", "-lc", "/c"]);

const commandName = (word: string) =>
  unquote(word)
    .toLowerCase()
    .replace(/\.exe$/, "");

function unquote(word: string): string {
  const first = word[0];
  const quoted =
    word.length >= 2 &&
    (first === '"' || first === "'") &&
    word.endsWith(first);
  return quoted ? word.slice(1, -1) : word;
}

// Splits into command parts of raw words (quotes kept); separators inside quotes do not split.
function tokenize(text: string): string[][] {
  const parts: string[][] = [[]];
  let word = "";
  let quote = "";
  const endWord = () => {
    if (word) parts[parts.length - 1].push(word);
    word = "";
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      word += char;
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
      word += char;
    } else if (/\s/.test(char)) {
      endWord();
    } else if (
      char === "|" ||
      char === ";" ||
      (char === "&" && text[i + 1] === "&")
    ) {
      endWord();
      parts.push([]);
      if (char === "&") i++;
    } else {
      word += char;
    }
  }
  endWord();
  return parts.filter((part) => part.length > 0);
}

function payloadOf(parts: string[][]): string | null {
  if (parts.length !== 1 || !SHELLS.has(commandName(parts[0][0]))) return null;
  const flagAt = parts[0].findIndex(
    (word, i) => i > 0 && COMMAND_FLAGS.has(word.toLowerCase()),
  );
  if (flagAt === -1) return null;
  const payload = parts[0].slice(flagAt + 1);
  return payload.length === 1 ? unquote(payload[0]) : payload.join(" ");
}

function toCommandText(
  command: unknown,
): { text: string; unwrapped: boolean } | null {
  if (typeof command === "string") return { text: command, unwrapped: false };
  if (
    !Array.isArray(command) ||
    !command.every((item) => typeof item === "string")
  )
    return null;
  const items = command as string[];
  const flagAt = items.findIndex((item) =>
    COMMAND_FLAGS.has(item.toLowerCase()),
  );
  const wrapped =
    items.length > 0 &&
    SHELLS.has(commandName(items[0])) &&
    flagAt > 0 &&
    flagAt === items.length - 2;
  return wrapped
    ? { text: items[flagAt + 1], unwrapped: true }
    : { text: items.join(" "), unwrapped: false };
}

export function parseShellCommand(command: unknown): ShellActivity {
  const reads: string[] = [];
  const searches: string[] = [];
  const source = toCommandText(command);
  if (source === null) return { reads, searches };

  const push = (list: string[], value: string) => {
    if (value && !list.includes(value)) list.push(value);
  };
  const isFlag = (word: string) => word.startsWith("-");
  const isPath = (word: string) => /[./\\]/.test(word);

  const payload = source.unwrapped ? null : payloadOf(tokenize(source.text));
  // A path after a folder change is relative to another folder, so later reads are dropped.
  let folderChanged = false;
  for (const part of tokenize(payload ?? source.text)) {
    const name = commandName(part[0]);
    const isGitGrep =
      name === "git" &&
      part[1] !== undefined &&
      commandName(part[1]) === "grep";
    const args = part.slice(isGitGrep ? 2 : 1).map(unquote);
    if (isGitGrep || SEARCHERS.has(name)) {
      const pattern = args.find((word) => !isFlag(word));
      if (pattern !== undefined) push(searches, pattern);
    } else if (FOLDER_CHANGERS.has(name)) {
      folderChanged = true;
    } else if (READERS.has(name) && !folderChanged) {
      const operands = args.filter((word) => !isFlag(word));
      // The first operand of sed is its script, never a file.
      for (const word of name === "sed" ? operands.slice(1) : operands) {
        if (isPath(word)) push(reads, word);
      }
    }
  }
  return { reads, searches };
}
