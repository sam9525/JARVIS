**1. Step 1 of 5: the spec. Here is what I understood**
**Answer** - The plain-text question panel misreads replies both ways. You want the real causes found, a failing test for each, and then a fix on a `fix/` branch from `develop`.
**Explain** - After the build, we test it live together with a list of messages. Nothing gets staged or committed until you review it.

**2. The panel opens for messages that are not questions. I found 4 causes**
**Answer** - I ran the parser on sample replies. These four open a panel by mistake.
**Explain** - A code block with a blank line inside it: the parser reads the block's last line (`// why?` followed by the closing fence) as the question.
**Explain** - A heading or label that ends in "?" followed by a list of statements. `What changed?` + `- Fixed the parser` becomes a question with two options. A quoted line `> Can you check the logs?` also opens a panel.
**Where** - `src/shared/text-question.ts:70-91`. The 4th cause is in `App.tsx:722-770`: only a new prompt, typing, or a terminal exit clears a text question. A later Stop that ends on a statement leaves the old question on screen.

**3. The panel stays closed for some real questions. I found 2 causes, and 1 needs a live check**
**Answer** - A loose list (a blank line between each option) after the question returns `null`. A question with a short line after it also returns `null`, for example "Want a PR? Let me know." or "...? (Optional.)".
**Explain** - The background Stop does not block the panel in the code. `mapTextQuestion` ignores `background_tasks`. That Stop only loses the finish message and the nudge (`status-mapper.ts:74-80`).
**Catch** - When background work ends, Claude Code starts a new turn by itself. If that turn fires `UserPromptSubmit`, the app clears an open question that you never answered. The transcripts cannot prove this either way. The live test checks it.

**4. One decision changes the rule**
**Answer** - Some replies are ambiguous. "Which one?" + a list and "What changed?" + a list have the same shape.
**Explain** - Option A, strict: the app ignores a question line written as a heading (`##`) or as a bold-only label, and it ignores code and quotes. Some real questions written as headings then get no panel.
**Explain** - Option B, loose: the app shows a panel for every "?" line except code and quotes. More summaries then open a panel that you must close.
**Answer** - I pick A. A wrong panel trains you to ignore the panel, and the terminal still shows a missed question.
**Next** - Reply with A or B, or correct anything above.
