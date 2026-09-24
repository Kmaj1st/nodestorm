// Unit tests never reach the real encyclopedias: requests to them fail like a network error (lookups then fall
// back to the AI, as they do offline). Tests of the lookup code pass their own fake `fetch`.
const LOOKUP_HOSTS = /(^|\.)(proofwiki\.org|wikipedia\.org|wikidata\.org|lean-lang\.org|openalex\.org)$/;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (LOOKUP_HOSTS.test(url.hostname)) throw new TypeError("network disabled in tests");
  return realFetch(input, init);
}) as typeof fetch;
