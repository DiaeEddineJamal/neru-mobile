// Neru Remote client: one encrypted WebSocket to the paired desktop, with request/reply and pushed events.
import { getRandomBytes } from 'expo-crypto';

import { connectionUrls, open, seal, type Pairing } from '@/remote/crypto';

export type Status = 'off' | 'connecting' | 'connected' | 'offline';
type Reply = { id: number; ok: boolean; data?: unknown; error?: string };
type Push = { event: string; payload: unknown };

export class RemoteClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private hostIndex = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private delay = 1000;
  private closed = false;
  private authenticated = false;
  private readyListeners = new Set<() => void>();

  constructor(
    private pairing: Pairing,
    private onEvent: (event: string, payload: unknown) => void,
    private onStatus: (status: Status, host?: string) => void,
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const urls = connectionUrls(this.pairing);
    const host = urls[this.hostIndex % urls.length];
    this.onStatus('connecting', host);
    const ws = new WebSocket(host);
    this.ws = ws;
    const deadline = setTimeout(() => { if (!this.authenticated && this.ws === ws) ws.close(); }, host.startsWith('wss:') ? 15000 : 6000);
    ws.onopen = () => {
      void this.request('hello').then(() => {
        if (this.closed || this.ws !== ws) return;
        clearTimeout(deadline);
        this.authenticated = true;
        this.delay = 1000;
        this.onStatus('connected', host);
        this.readyListeners.forEach(fn => fn());
      }).catch(() => ws.close());
    };
    ws.onmessage = e => {
      let msg: Reply | Push;
      try {
        msg = JSON.parse(open(this.pairing.key, String(e.data)));
      } catch {
        return ws.close(); // not sealed with our key: wrong desktop or a reset pairing
      }
      if ('event' in msg) return this.onEvent(msg.event, msg.payload);
      const w = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      if (msg.ok) w?.resolve(msg.data);
      else w?.reject(new Error(msg.error ?? 'The desktop could not do that.'));
    };
    ws.onclose = () => {
      clearTimeout(deadline);
      if (this.ws !== ws) return;
      this.ws = null;
      this.authenticated = false;
      for (const w of this.waiting.values()) w.reject(new Error('Lost the connection to your desktop.'));
      this.waiting.clear();
      if (this.closed) return;
      // Try the next LAN address the desktop advertised, then back off.
      this.hostIndex++;
      this.onStatus('offline');
      this.retry = setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    };
  }

  whenConnected(): Promise<void> {
    if (this.authenticated) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timeout); this.readyListeners.delete(done); resolve(); };
      const timeout = setTimeout(() => { this.readyListeners.delete(done); reject(new Error('Could not connect. Keep Neru open and awake, and check internet access or local Wi-Fi.')); }, this.pairing.endpoint ? 60000 : 25000);
      this.readyListeners.add(done);
    });
  }

  request<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Your desktop is not connected.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: v => resolve(v as T), reject });
      try { ws.send(seal(this.pairing.key, getRandomBytes(24), JSON.stringify({ id, cmd, args }))); }
      catch (e) { this.waiting.delete(id); reject(e); return; }
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error('Your desktop did not answer.'));
      }, 20_000);
    });
  }

  /** Reconnect now, e.g. when the app returns to the foreground. */
  wake() {
    if (this.closed) return;
    if (this.ws) { this.ws.close(); return; }
    if (this.retry) clearTimeout(this.retry);
    this.delay = 1000;
    this.connect();
  }

  close() {
    this.closed = true;
    this.authenticated = false;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    this.onStatus('off');
  }
}
