import { describe, expect, it } from "vitest";
import { notificationPayload } from "../../../src/main/agents/antigravity-notify";
import { mapStatusEvent } from "../../../src/main/status-mapper";
import { createStatusStore } from "../../../src/main/workspace-status";
import { buildWorkspaces } from "../../../src/main/workspaces";
import type { RawHookEvent } from "../../../src/main/event-mapper";

const ctx = { key: "C:/work/demo#1", cwd: "C:\\work\\demo", sessionId: "A" };

describe("notificationPayload", () => {
  it("reads a tool confirmation as a permission prompt", () => {
    expect(
      notificationPayload("Antigravity CLI needs tool confirmation", ctx),
    ).toEqual({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      jarvis_session: ctx.key,
      jarvis_agent: "antigravity",
      cwd: ctx.cwd,
      session_id: "A",
    });
  });

  it("reads any other need as a permission prompt", () => {
    expect(
      notificationPayload("Antigravity CLI needs plan approval", ctx)
        ?.notification_type,
    ).toBe("permission_prompt");
  });

  it("reads ready for input as an idle prompt", () => {
    expect(
      notificationPayload("Antigravity CLI is ready for input", ctx),
    ).toEqual({
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
      jarvis_session: ctx.key,
      jarvis_agent: "antigravity",
      cwd: ctx.cwd,
      session_id: "A",
    });
  });

  it("ignores every other text", () => {
    expect(notificationPayload("Antigravity CLI needs", ctx)).toBeNull();
    expect(notificationPayload("Antigravity CLI needs ", ctx)).toBeNull();
    expect(notificationPayload("", ctx)).toBeNull();
    expect(notificationPayload("Build finished", ctx)).toBeNull();
    expect(
      notificationPayload("Antigravity CLI is ready for input!", ctx),
    ).toBeNull();
  });
});

describe("notification payloads through the status pipeline", () => {
  const workspaces = buildWorkspaces("D:\\vault", [
    { name: "demo", path: "C:\\work\\demo" },
  ]);
  const wsId = workspaces.find((w) => w.name === "demo")?.id ?? "";
  const key = `${wsId}#1`;
  const notifyCtx = { key, cwd: "C:\\work\\demo", sessionId: "A" };
  const hook = (fields: Partial<RawHookEvent>): RawHookEvent => ({
    session_id: "A",
    cwd: "C:\\work\\demo",
    jarvis_session: key,
    jarvis_agent: "antigravity",
    ...fields,
  });

  function pipeline() {
    const store = createStatusStore(() => workspaces.map((w) => w.id));
    // hooks tagged with the app's own key apply only while its pty lives
    store.ptyLaunched(key, 0);
    const apply = (raw: RawHookEvent | null) => {
      const s = raw ? mapStatusEvent(raw, workspaces) : null;
      if (s) store.applyStatus(s);
    };
    const row = () =>
      store
        .snapshot()
        .flatMap((w) => w.sessions)
        .find((s) => s.key === key);
    return { apply, row };
  }

  it("blocks on a permission prompt and works again on the next tool", () => {
    const p = pipeline();
    p.apply(
      hook({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      }),
    );
    p.apply(
      notificationPayload("Antigravity CLI needs tool confirmation", notifyCtx),
    );
    expect(p.row()?.kind).toBe("blocked");
    p.apply(
      hook({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      }),
    );
    expect(p.row()?.kind).toBe("working");
  });

  it("keeps the finish when ready for input follows a Stop", () => {
    const p = pipeline();
    p.apply(hook({ hook_event_name: "UserPromptSubmit", prompt: "go" }));
    p.apply(hook({ hook_event_name: "Stop", last_assistant_message: "done" }));
    p.apply(
      notificationPayload("Antigravity CLI is ready for input", notifyCtx),
    );
    expect(p.row()?.kind).toBe("idle");
    expect(p.row()?.ended).toBe("finished");
  });
});
