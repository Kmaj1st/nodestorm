// Imported first by main.tsx, before any module parses with zod. Zod compiles fast parsers with `new Function`,
// after probing for it; the production build's Content-Security-Policy forbids eval (pwa/csp.ts), so the probe
// would only fail and be reported as a violation. Parsing works the same without it.
import { z } from "zod";

z.config({ jitless: true });
