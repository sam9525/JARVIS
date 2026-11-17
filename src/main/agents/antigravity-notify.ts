import type { RawHookEvent } from "../event-mapper";

const NEEDS_PREFIX = "Antigravity CLI needs ";
const READY_TEXT = "Antigravity CLI is ready for input";

function notificationTypeOf(text: string): string | null {
  if (text.startsWith(NEEDS_PREFIX) && text.length > NEEDS_PREFIX.length)
    return "permission_prompt";
  if (text === READY_TEXT) return "idle_prompt";
  return null;
}

/** The Claude-shaped Notification for one of agy's terminal notification
 * texts, or null for any text it does not send. */
export function notificationPayload(
  text: string,
  ctx: { key: string; cwd: string; sessionId: string },
): RawHookEvent | null {
  const type = notificationTypeOf(text);
  if (type === null) return null;
  return {
    hook_event_name: "Notification",
    notification_type: type,
    jarvis_session: ctx.key,
    jarvis_agent: "antigravity",
    cwd: ctx.cwd,
    session_id: ctx.sessionId,
  };
}
