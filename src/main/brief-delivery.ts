import { SETTLE_MS } from "./main-agent";

/** How long one typed briefing waits for Claude Code to report it submitted. */
export const BRIEF_CONFIRM_MS = 20_000;

/** Rounds before the day is left unstamped for the next boot: about 5 min. */
export const BRIEF_TRIES = 15;

/**
 * Types the briefing until its own UserPromptSubmit arrives. A resumed long
 * session goes quiet before its composer reads input, so a successful write
 * proves nothing; only the submit hook does. `outcome` resolves true for the
 * briefing's submit and false for any other prompt, which ends the retries so
 * a turn the user started is never typed over. Resolves whether it landed.
 * A session no hook has been heard from cannot confirm anything, so its
 * briefing is typed once and never again.
 */
export async function deliverBriefing(deps: {
  type(): boolean;
  msSinceOutput(): number;
  hooksHeard(): boolean;
  promptOpen(): boolean;
  outcome: Promise<boolean>;
}): Promise<boolean> {
  let typed = false;
  for (let i = 0; i < BRIEF_TRIES; i++) {
    if (typed && !deps.hooksHeard()) return false;
    // a terminal still painting is not reading yet, and an open prompt would
    // take the Enter as a choice; the next round looks again
    if (deps.msSinceOutput() >= SETTLE_MS && !deps.promptOpen()) {
      if (!deps.type()) return false;
      typed = true;
    }
    const answer = await Promise.race([
      deps.outcome,
      new Promise<null>((r) => setTimeout(() => r(null), BRIEF_CONFIRM_MS)),
    ]);
    if (answer !== null) return answer;
  }
  return false;
}
