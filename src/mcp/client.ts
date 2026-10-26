// A Model Context Protocol client over Streamable HTTP, straight from the phone: no desktop needed. Each request is a
// JSON-RPC POST; the server answers with JSON or a short event stream. The session id the server hands out on
// `initialize` goes back on every later request.

export type McpTool = { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean };

/** An HTTP failure, with the WWW-Authenticate header a 401 carries (it points to the sign-in server). */
export class McpHttpError extends Error {
  readonly status: number;
  readonly wwwAuthenticate: string | null;
  constructor(message: string, status: number, wwwAuthenticate: string | null) {
    super(message);
    this.status = status;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

const PROTOCOL = '2025-06-18';
let nextId = 1;

export class McpSession {
  private sessionId: string | null = null;
  private ready = false;

  readonly url: string;
  private auth: () => Promise<string | null>;
  constructor(url: string, auth: () => Promise<string | null>) {
    this.url = url;
    this.auth = auth;
  }

  private async post(body: Record<string, unknown>, timeoutMs = 60_000): Promise<{ status: number; data: unknown }> {
    const token = await this.auth();
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL };
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: abort.signal });
    } catch (err) {
      throw new Error(abort.signal.aborted ? 'The connector did not answer in time.' : `Could not reach the connector: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (res.status === 202) return { status: 202, data: null };
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      if (res.status === 404 && this.sessionId) this.reset(); // the server forgot the session: start again
      throw new McpHttpError(res.status === 401 ? 'Sign in to this connector again.' : `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, res.headers.get('www-authenticate'));
    }
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream')) {
      // The reply is the event whose JSON carries our id.
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try {
          const msg = JSON.parse(data);
          if (msg.id === body.id) return { status: res.status, data: msg };
        } catch {}
      }
      throw new Error('The connector closed the stream without an answer.');
    }
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }

  private async request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    const id = nextId++;
    const { data } = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs);
    const msg = data as { result?: T; error?: { message?: string } } | null;
    if (msg?.error) throw new Error(msg.error.message ?? `${method} failed`);
    return msg?.result as T;
  }

  reset() {
    this.sessionId = null;
    this.ready = false;
  }

  async connect() {
    if (this.ready) return;
    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Neru', version: '1' } }, 30_000);
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
    this.ready = true;
  }

  /** Every tool, across pages. */
  async tools(): Promise<McpTool[]> {
    await this.connect();
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.request<{ tools?: { name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; title?: string } }[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {});
      for (const t of result?.tools ?? [])
        out.push({ name: t.name, title: t.title ?? t.annotations?.title, description: t.description ?? '', inputSchema: t.inputSchema ?? { type: 'object', properties: {} }, readOnly: t.annotations?.readOnlyHint === true });
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  /** Calls a tool and flattens its content to text for the model. */
  async call(tool: string, args: Record<string, unknown>): Promise<string> {
    const run = async () => {
      await this.connect();
      return this.request<{ content?: { type: string; text?: string; resource?: { text?: string } }[]; structuredContent?: unknown; isError?: boolean }>('tools/call', { name: tool, arguments: args }, 180_000);
    };
    let result;
    try {
      result = await run();
    } catch (err) {
      if (!(err instanceof McpHttpError && err.status === 404)) throw err;
      result = await run(); // the session expired; reset() already ran
    }
    let text = (result?.content ?? []).map(p => (p.type === 'text' ? (p.text ?? '') : p.type === 'resource' ? (p.resource?.text ?? '[binary resource]') : `[${p.type} content]`)).join('\n');
    if (!text.trim() && result?.structuredContent !== undefined) text = JSON.stringify(result.structuredContent);
    if (text.length > 40_000) text = `${text.slice(0, 40_000)}\n[output truncated]`;
    return result?.isError ? `Error from the connector: ${text}` : text;
  }
}
