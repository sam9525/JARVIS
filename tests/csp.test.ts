import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The CSP is the only thing standing between a malicious note's injected
// HTML and full-vault exfiltration (Preview renders marked output
// unsanitized). This test fails if the meta tag is removed or loosened.
describe("index.html Content-Security-Policy", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  );

  it("declares a CSP meta tag", () => {
    expect(match).not.toBeNull();
  });

  it("locks down the directives that block exfiltration", () => {
    const csp = match ? match[1] : "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toMatch(/connect-src 'self'[^;]*$|connect-src 'self'[^;]*;/);
    // script-src must NOT allow inline handlers like <img onerror=...>
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // img-src must not allow arbitrary remote hosts
    expect(csp).toMatch(/img-src 'self' data:(;|$)/);
  });
});
