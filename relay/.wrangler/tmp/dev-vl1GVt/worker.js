var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var HOSTS = new Set(`
api.openai.com api.anthropic.com generativelanguage.googleapis.com openrouter.ai api.groq.com
router.huggingface.co api.deepseek.com api.mistral.ai api.x.ai api.together.xyz api.fireworks.ai
api.cerebras.ai integrate.api.nvidia.com api.sambanova.ai api.deepinfra.com api.hyperbolic.xyz
api.novita.ai api.tokenfactory.nebius.com api.studio.nebius.com llm.chutes.ai api.siliconflow.com
api.inference.net api.moonshot.ai api.z.ai dashscope-intl.aliyuncs.com api.minimax.io api.cohere.ai
api.scaleway.ai openai.inference.de-txl.ionos.com
`.split(/\s+/).filter(Boolean));
var FORWARD = ["authorization", "content-type", "accept", "x-title", "http-referer", "anthropic-version", "x-api-key"];
var cors = /* @__PURE__ */ __name((origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
  "Access-Control-Allow-Headers": "authorization, content-type, x-jean-key, x-title, http-referer, anthropic-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
}), "cors");
var fail = /* @__PURE__ */ __name((status, message, origin) => new Response(JSON.stringify({ error: { message, type: "jean_relay_error" } }), {
  status,
  headers: { "Content-Type": "application/json", ...cors(origin) }
}), "fail");
function same(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
__name(same, "same");
var worker_default = {
  async fetch(req, env) {
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(req.url);
    if (url.pathname === "/health")
      return new Response('{"ok":true}', { headers: { "Content-Type": "application/json", ...cors(origin) } });
    if (url.pathname.startsWith("/remote/"))
      return remote(req, env, url);
    if (!url.pathname.startsWith("/relay/"))
      return fail(404, "Usa /relay/<host>/<ruta>.", origin);
    if (!env.RELAY_KEY || !same(req.headers.get("X-Jean-Key") || "", env.RELAY_KEY))
      return fail(401, "X-Jean-Key inv\xE1lida o ausente.", origin);
    if (!["GET", "POST"].includes(req.method))
      return fail(405, "Solo GET y POST.", origin);
    const rest = url.pathname.slice("/relay/".length);
    const slash = rest.indexOf("/");
    const host = (slash > 0 ? rest.slice(0, slash) : "").toLowerCase();
    const extra = new Set(String(env.RELAY_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
    if (!host || !/^[a-z0-9.-]+$/.test(host))
      return fail(400, "Ruta de relay inv\xE1lida.", origin);
    if (!HOSTS.has(host) && !extra.has(host))
      return fail(403, `El relay no reenv\xEDa a ${host}. A\xF1\xE1delo a RELAY_HOSTS si es tuyo.`, origin);
    const headers = {};
    for (const h of FORWARD) {
      const v = req.headers.get(h);
      if (v)
        headers[h] = v;
    }
    let upstream;
    try {
      upstream = await fetch(`https://${host}${rest.slice(slash)}${url.search}`, {
        method: req.method,
        headers,
        body: req.method === "POST" ? req.body : void 0,
        redirect: "manual"
      });
    } catch (e) {
      return fail(502, `No se pudo contactar con el proveedor (${e.name}).`, origin);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-cache", ...cors(origin) }
    });
  }
};
async function remote(req, env, url) {
  const room = url.pathname.slice("/remote/".length);
  const role = url.searchParams.get("role");
  if (!/^[0-9a-f]{32}$/.test(room) || !["host", "phone"].includes(role))
    return new Response("sala o rol no v\xE1lidos", { status: 400 });
  if (env.RELAY_KEY && !same(url.searchParams.get("k") || "", env.RELAY_KEY))
    return new Response("clave no v\xE1lida", { status: 401 });
  if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket")
    return new Response("se espera un WebSocket", { status: 426 });
  if (!env.REMOTE)
    return new Response("falta el Durable Object REMOTE en wrangler.toml", { status: 501 });
  return env.REMOTE.get(env.REMOTE.idFromName(room)).fetch(req);
}
__name(remote, "remote");
var MAX_REMOTE_FRAME = 1e6;
var MAX_PHONES = 3;
var RemoteRoom = class {
  constructor(state) {
    this.state = state;
  }
  async fetch(req) {
    const role = new URL(req.url).searchParams.get("role");
    const same2 = this.state.getWebSockets(role);
    if (role === "host")
      for (const ws of same2) {
        try {
          ws.close(4e3, "otro PC ocup\xF3 la sala");
        } catch {
        }
      }
    if (role === "phone" && same2.length >= MAX_PHONES)
      return new Response("demasiados m\xF3viles en esta sala", { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server, [role]);
    this.notify(role, "join");
    return new Response(null, { status: 101, webSocket: client });
  }
  other(role) {
    return this.state.getWebSockets(role === "host" ? "phone" : "host");
  }
  roleOf(ws) {
    return this.state.getTags(ws)[0];
  }
  notify(role, state) {
    for (const ws of this.other(role)) {
      try {
        ws.send(JSON.stringify({ t: "peer", role, state }));
      } catch {
      }
    }
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== "string" || msg.length > MAX_REMOTE_FRAME)
      return;
    if (!/^\{"t":"(hello|welcome|msg)"/.test(msg))
      return;
    for (const peer of this.other(this.roleOf(ws))) {
      try {
        peer.send(msg);
      } catch {
      }
    }
  }
  async webSocketClose(ws) {
    this.notify(this.roleOf(ws), "leave");
  }
  async webSocketError(ws) {
    this.notify(this.roleOf(ws), "leave");
  }
};
__name(RemoteRoom, "RemoteRoom");

// ../../Coder Breakers/.npm-cache/_npx/d12df5bd68f8c335/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../Coder Breakers/.npm-cache/_npx/d12df5bd68f8c335/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-AGpcUW/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../Coder Breakers/.npm-cache/_npx/d12df5bd68f8c335/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-AGpcUW/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RemoteRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
