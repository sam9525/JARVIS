import { describe, expect, it } from "vitest";
import {
  locateAntigravity,
  type LocateDeps,
} from "../../../src/main/agents/antigravity-locate";

const WIN_HOME = "C:\\Users\\sam";
const WIN_LOCAL = "C:\\Users\\sam\\AppData\\Local";
const WIN_HOME_EXE = "C:\\Users\\sam\\.gemini\\bin\\agy.exe";
const WIN_LOCAL_EXE = "C:\\Users\\sam\\AppData\\Local\\agy\\bin\\agy.exe";
const WIN_PATH_EXE = "C:\\tools\\agy.exe";

function windows(files: string[], env: NodeJS.ProcessEnv): LocateDeps {
  return {
    platform: "win32",
    env,
    home: WIN_HOME,
    exists: async (path) => files.includes(path),
  };
}

function posix(
  platform: NodeJS.Platform,
  files: string[],
  env: NodeJS.ProcessEnv,
): LocateDeps {
  return {
    platform,
    env,
    home: "/home/sam",
    exists: async (path) => files.includes(path),
  };
}

describe("locateAntigravity", () => {
  it("prefers the home folder's agy.exe over every other place on Windows", async () => {
    const deps = windows([WIN_HOME_EXE, WIN_LOCAL_EXE, WIN_PATH_EXE], {
      LOCALAPPDATA: WIN_LOCAL,
      PATH: "C:\\tools",
    });
    expect(await locateAntigravity(deps)).toBe(WIN_HOME_EXE);
  });

  it("prefers the LOCALAPPDATA agy.exe over PATH on Windows", async () => {
    const deps = windows([WIN_LOCAL_EXE, WIN_PATH_EXE], {
      LOCALAPPDATA: WIN_LOCAL,
      PATH: "C:\\tools",
    });
    expect(await locateAntigravity(deps)).toBe(WIN_LOCAL_EXE);
  });

  it("finds agy.exe in a later PATH folder on Windows", async () => {
    const deps = windows([WIN_PATH_EXE], {
      LOCALAPPDATA: WIN_LOCAL,
      PATH: "C:\\empty;C:\\tools",
    });
    expect(await locateAntigravity(deps)).toBe(WIN_PATH_EXE);
  });

  it("reads the Windows PATH from the Path spelling", async () => {
    const deps = windows([WIN_PATH_EXE], { Path: "C:\\tools" });
    expect(await locateAntigravity(deps)).toBe(WIN_PATH_EXE);
  });

  it("returns null when a Windows PATH holds only agy.cmd or a bare agy", async () => {
    const deps = windows(["C:\\npm\\agy.cmd", "C:\\shim\\agy"], {
      LOCALAPPDATA: WIN_LOCAL,
      PATH: "C:\\npm;C:\\shim",
    });
    expect(await locateAntigravity(deps)).toBeNull();
  });

  it("returns null when nothing is found", async () => {
    const deps = windows([], { LOCALAPPDATA: WIN_LOCAL, PATH: "C:\\tools" });
    expect(await locateAntigravity(deps)).toBeNull();
    expect(await locateAntigravity(posix("linux", [], {}))).toBeNull();
  });

  it("skips the LOCALAPPDATA place when the variable is missing", async () => {
    const deps = windows([WIN_PATH_EXE], { PATH: "C:\\tools" });
    expect(await locateAntigravity(deps)).toBe(WIN_PATH_EXE);
    expect(await locateAntigravity(windows([], {}))).toBeNull();
  });

  it("prefers the home folder's agy over PATH off Windows", async () => {
    const deps = posix(
      "darwin",
      ["/home/sam/.gemini/bin/agy", "/usr/local/bin/agy"],
      { PATH: "/usr/local/bin" },
    );
    expect(await locateAntigravity(deps)).toBe("/home/sam/.gemini/bin/agy");
  });

  it("finds agy on a posix PATH", async () => {
    const deps = posix("linux", ["/usr/local/bin/agy"], {
      PATH: "/usr/bin:/usr/local/bin",
    });
    expect(await locateAntigravity(deps)).toBe("/usr/local/bin/agy");
  });

  it("never looks in LOCALAPPDATA off Windows", async () => {
    const deps = posix(
      "linux",
      ["/local/agy/bin/agy", "/local/agy/bin/agy.exe"],
      {
        LOCALAPPDATA: "/local",
        PATH: "",
      },
    );
    expect(await locateAntigravity(deps)).toBeNull();
  });
});
