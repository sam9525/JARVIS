import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSlashCommands } from "../../src/main/slash-commands";

let root: string;
let cwd: string;
let home: string;

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

function skill(name: string, description = "", extra = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\nbody\n`;
}

async function names(): Promise<string[]> {
  return (await listSlashCommands(cwd, home)).map((c) => c.name).sort();
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "slash-"));
  cwd = path.join(root, "project");
  home = path.join(root, "home");
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(home, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function installPlugin(
  key: string,
  enabled: boolean | undefined,
): Promise<string> {
  const installPath = path.join(root, "plugin-cache", key);
  await write(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { [key]: [{ installPath }] } }),
  );
  await write(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({
      enabledPlugins: enabled === undefined ? {} : { [key]: enabled },
    }),
  );
  await write(
    path.join(installPath, "skills", "writing-plans", "SKILL.md"),
    skill("writing-plans", "Plan it"),
  );
  await write(path.join(installPath, "commands", "go.md"), "do it\n");
  return installPath;
}

describe("listSlashCommands", () => {
  it("finds project and user skills and commands", async () => {
    await write(
      path.join(cwd, ".claude", "skills", "alpha", "SKILL.md"),
      skill("alpha", "A skill"),
    );
    await write(path.join(cwd, ".claude", "commands", "beta.md"), "x\n");
    await write(
      path.join(home, ".claude", "skills", "gamma", "SKILL.md"),
      skill("gamma"),
    );
    await write(path.join(home, ".claude", "commands", "delta.md"), "x\n");
    expect(await names()).toEqual(["alpha", "beta", "delta", "gamma"]);
    const alpha = (await listSlashCommands(cwd, home)).find(
      (c) => c.name === "alpha",
    );
    expect(alpha?.description).toBe("A skill");
  });

  it("prefixes a plugin's skills and commands", async () => {
    await installPlugin("superpowers@claude-plugins-official", true);
    expect(await names()).toEqual([
      "superpowers:go",
      "superpowers:writing-plans",
    ]);
  });

  it("leaves out a plugin that is not enabled", async () => {
    await installPlugin("superpowers@claude-plugins-official", undefined);
    expect(await names()).toEqual([]);
  });

  it("leaves out a plugin set to false", async () => {
    await installPlugin("superpowers@claude-plugins-official", false);
    expect(await names()).toEqual([]);
  });

  it("leaves out user-invocable false", async () => {
    await write(
      path.join(cwd, ".claude", "skills", "hidden", "SKILL.md"),
      skill("hidden", "", "user-invocable: false\n"),
    );
    await write(
      path.join(cwd, ".claude", "skills", "shown", "SKILL.md"),
      skill("shown"),
    );
    expect(await names()).toEqual(["shown"]);
  });

  it("a project skill hides a user skill of the same name", async () => {
    await write(
      path.join(cwd, ".claude", "skills", "same", "SKILL.md"),
      skill("same", "project"),
    );
    await write(
      path.join(home, ".claude", "skills", "same", "SKILL.md"),
      skill("same", "user"),
    );
    const list = await listSlashCommands(cwd, home);
    expect(list).toEqual([{ name: "same", description: "project" }]);
  });

  it("reads frontmatter with CRLF and with a quoted description", async () => {
    await write(
      path.join(cwd, ".claude", "skills", "crlf", "SKILL.md"),
      '---\r\nname: crlf\r\ndescription: "Quoted: text"\r\n---\r\nbody\r\n',
    );
    expect(await listSlashCommands(cwd, home)).toEqual([
      { name: "crlf", description: "Quoted: text" },
    ]);
  });

  it("uses the folder name when the frontmatter has no name", async () => {
    await write(
      path.join(cwd, ".claude", "skills", "folder-name", "SKILL.md"),
      "---\ndescription: d\n---\nbody\n",
    );
    expect(await names()).toEqual(["folder-name"]);
  });

  it("a folder with no SKILL.md gives no row", async () => {
    await fs.mkdir(path.join(cwd, ".claude", "skills", "empty"), {
      recursive: true,
    });
    expect(await names()).toEqual([]);
  });

  it("missing folders and bad JSON give a shorter list and do not throw", async () => {
    expect(await names()).toEqual([]);
    await write(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      "{not json",
    );
    await write(path.join(home, ".claude", "settings.json"), "also bad");
    await write(path.join(cwd, ".claude", "commands", "ok.md"), "x\n");
    expect(await names()).toEqual(["ok"]);
  });
});

describe("frontmatter values", () => {
  async function descriptionOf(front: string): Promise<string | undefined> {
    await write(
      path.join(cwd, ".claude", "skills", "s", "SKILL.md"),
      `---\nname: s\n${front}---\nbody\n`,
    );
    return (await listSlashCommands(cwd, home))[0]?.description;
  }

  it("joins a folded >- block with spaces", async () => {
    expect(
      await descriptionOf("description: >-\n  first line\n  second line\n"),
    ).toBe("first line second line");
  });

  it("joins a | block with spaces", async () => {
    expect(await descriptionOf("description: |\n  one\n  two\n")).toBe(
      "one two",
    );
  });

  it("unescapes quotes and backslashes in a double-quoted value", async () => {
    const front = String.raw`description: "say \"hi\" a\\b"` + "\n";
    expect(await descriptionOf(front)).toBe(String.raw`say "hi" a\b`);
  });
});
