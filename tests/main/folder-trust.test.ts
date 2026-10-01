import { describe, expect, it } from "vitest";
import { isTrusted } from "../../src/main/folder-trust";

const config = (projects: Record<string, unknown>) => async () =>
  JSON.stringify({ projects });

describe("isTrusted", () => {
  it("reads the folder's own trust flag, whatever its slashes and case", async () => {
    const read = config({
      "D:/Obsidian-valut": { hasTrustDialogAccepted: true },
    });
    expect(await isTrusted("d:\\obsidian-valut\\", "h", read)).toBe(true);
  });

  it("is false for a folder Claude Code has not trusted", async () => {
    const read = config({
      "D:/new": { hasTrustDialogAccepted: false },
      "D:/other": { hasTrustDialogAccepted: true },
    });
    expect(await isTrusted("D:\\new", "h", read)).toBe(false);
    expect(await isTrusted("D:\\otherwise", "h", read)).toBe(false);
  });

  it("counts a trusted parent folder", async () => {
    const read = config({ "D:/data": { hasTrustDialogAccepted: true } });
    expect(await isTrusted("D:\\data\\Program\\X", "h", read)).toBe(true);
  });

  it("is false with no config file yet", async () => {
    const read = async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    };
    expect(await isTrusted("D:\\x", "h", read)).toBe(false);
  });

  it("is null when the config cannot be read or parsed", async () => {
    const locked = async () => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    };
    expect(await isTrusted("D:\\x", "h", locked)).toBeNull();
    expect(await isTrusted("D:\\x", "h", async () => "{oops")).toBeNull();
  });
});
