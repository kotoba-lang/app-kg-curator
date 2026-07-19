// kg-curator thin edge facade. KG generation logic runs in AgentGateway MCP + pod-side LangServer.

interface SecretBinding { get(): Promise<string>; }
interface Env { DISPATCHER_URL?: string; DISPATCHER_INTERNAL_SECRET?: string | SecretBinding; APP_NANOID?: string; }
interface ExecutionContextLike { waitUntil(promise: Promise<unknown>): void; }
interface QueueMessage { body: unknown; ack(): void; retry(): void; }
interface MessageBatch { messages: QueueMessage[]; }
interface ExportedHandler<E> {
  fetch(req: Request, env: E): Promise<Response>;
  scheduled?(event: unknown, env: E, ctx: ExecutionContextLike): Promise<void>;
  queue?(batch: MessageBatch, env: E, ctx: ExecutionContextLike): Promise<void>;
}

const APP = "kgCurator";
const NSID_PREFIX = "com.etzhayyim.apps.kgCurator.";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health" || url.pathname === "/_app/meta") {
      return json({
        ok: true,
        actor: "did:web:kg-curator.etzhayyim.com",
        nanoid: env.APP_NANOID ?? "kg7r4t0r",
        execution: "edge-proxy+agentgateway-mcp+langserver",
        businessLogic: "40-engine/kotoba/crates/kotoba-kotodama/py/src/kotodama/ingest/kg_curator.py",
        bpmn: "etzhayyim-root/00-contracts/bpmn/com/etzhayyim/kgCurator",
      });
    }
    const nsid = url.pathname.startsWith("/xrpc/") ? url.pathname.slice("/xrpc/".length) : "";
    if (nsid.startsWith(NSID_PREFIX) && (req.method === "POST" || req.method === "GET")) {
      const body = await bodyWithQuery(req, url);
      if (body.__invalidJson) return json({ error: "InvalidJson" }, 400);
      return proxyToDispatcher(env, nsid, body);
    }
    return json({ error: "NotFound", message: `${APP} not found` }, 404);
  },

  async scheduled(_event: unknown, env: Env, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil(proxyToDispatcher(env, `${NSID_PREFIX}analyzeCoverage`, {}).catch((err) => console.error("analyzeCoverage cron failed", err)));
  },

  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContextLike): Promise<void> {
    for (const msg of batch.messages) {
      ctx.waitUntil(
        proxyToDispatcher(env, `${NSID_PREFIX}expandTitle`, normalizeQueueBody(msg.body))
          .then((resp) => { if (resp.ok) msg.ack(); else msg.retry(); })
          .catch(() => msg.retry()),
      );
    }
  },
} satisfies ExportedHandler<Env>;

function normalizeQueueBody(body: unknown): Record<string, unknown> {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  return {
    scope_did: raw.scope_did ?? raw.scopeDid,
    target_count: raw.target_count ?? raw.targetCount ?? 12,
  };
}

async function bodyWithQuery(req: Request, url: URL): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    const text = await req.text();
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return { __invalidJson: true };
    }
  }
  for (const [k, v] of url.searchParams) if (!(k in body)) body[k] = v;
  return body;
}

async function proxyToDispatcher(env: Env, nsid: string, body: Record<string, unknown>): Promise<Response> {
  const base = (env.DISPATCHER_URL ?? "https://dispatcher.etzhayyim.com").replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const trust = await internalTrustSecret(env);
  if (trust) headers["x-internal-trust"] = trust;
  const resp = await fetch(`${base}/xrpc/${nsid}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: {
      "content-type": resp.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

async function internalTrustSecret(env: Env): Promise<string> {
  const binding = env.DISPATCHER_INTERNAL_SECRET;
  if (!binding) return "";
  try {
    return typeof binding === "string" ? binding : await binding.get();
  } catch {
    return "";
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
