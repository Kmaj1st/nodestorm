import type {
  DepsRequest,
  DepsResponse,
  DeriveRequest,
  DeriveResponse,
  NameRequest,
  NameResponse,
  ProvidersResponse,
  RelateRequest,
  RelateResponse,
} from "@nodestorm/shared";

let providerOverride: string | null = null;
export function setProvider(id: string | null) {
  providerOverride = id;
}

async function post<Req, Res>(path: string, body: Req): Promise<Res> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(providerOverride ? { "x-ai-provider": providerOverride } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as Res;
}

export const api = {
  providers: async (): Promise<ProvidersResponse> => (await fetch("/api/providers")).json(),
  name: (req: NameRequest) => post<NameRequest, NameResponse>("name", req),
  relate: (req: RelateRequest) => post<RelateRequest, RelateResponse>("relate", req),
  deps: (req: DepsRequest) => post<DepsRequest, DepsResponse>("deps", req),
  derive: (req: DeriveRequest) => post<DeriveRequest, DeriveResponse>("derive", req),
};
