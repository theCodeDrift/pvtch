// Test-only stub for `cloudflare:workers`. The runtime module is unavailable
// outside the Workers runtime; vitest tests run in Node, so we provide
// no-op base classes that DO/RpcTarget code can safely extend.

export class DurableObject<EnvType = unknown> {
  protected ctx: DurableObjectState;
  protected env: EnvType;
  constructor(ctx: DurableObjectState, env: EnvType) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}
