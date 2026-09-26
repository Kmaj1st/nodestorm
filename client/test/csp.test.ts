import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, cspMetaTag } from "../pwa/csp";
import { BAIKE_FRAME_SCRIPT, baikeFrameDoc } from "../src/lib/baikeFrame";

const directives = (csp: string) =>
  new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)] as const));

describe("Content-Security-Policy of the production build", () => {
  const csp = directives(contentSecurityPolicy());

  it("only runs the app's own scripts: no inline code, no eval, no plugins", () => {
    const script = csp.get("script-src")!;
    expect(script).toContain("'self'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script.filter((s) => !s.startsWith("'sha256-"))).toEqual(["'self'", "https://baike.baidu.com"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
  });

  it("allows the Baidu Baike frame's one inline script by its hash (the frame inherits the page's policy)", () => {
    const hash = createHash("sha256").update(BAIKE_FRAME_SCRIPT).digest("base64");
    expect(csp.get("script-src")).toContain(`'sha256-${hash}'`);
  });

  it("still lets the page reach any AI endpoint the user sets up (e.g. a local model on http://localhost)", () => {
    expect(csp.get("connect-src")).toEqual(expect.arrayContaining(["https:", "http:"]));
  });

  it("is a meta tag with the policy HTML-escaped", () => {
    expect(cspMetaTag()).toMatch(/^<meta http-equiv="Content-Security-Policy" content="[^"<>]+">$/);
  });
});

describe("Baidu Baike frame", () => {
  const doc = baikeFrameDoc("https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?bk_key=%22%3E&callback=cb", 'n"<>&');

  it("has exactly one inline script, the hashed one, and no inline event handlers", () => {
    const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toEqual([BAIKE_FRAME_SCRIPT]);
    expect(doc).not.toMatch(/\son\w+\s*=/i);
    expect(doc.match(/<script/g)).toHaveLength(1);
  });

  it("passes the address and nonce as escaped attributes", () => {
    expect(doc).toContain('data-nonce="n&quot;&lt;>&amp;"');
    expect(doc).toContain('data-src="https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?bk_key=%22%3E&amp;callback=cb"');
  });
});
