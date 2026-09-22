import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  maxMessageBytes?: number;
}

export class RpcError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'RpcError';
  }
}

/** The caller owns the explicit environment. Personal Codex credentials are never inherited here. */
export class CodexClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private ended = false;
  private ready = false;
  private initializing?: Promise<unknown>;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private serverRequests = new Set<number | string>();
  private exitPromise: Promise<void>;

  constructor(private readonly options: ClientOptions) {
    super();
    this.child = spawn(options.command, options.args ?? ['app-server'], {
      cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
      detached: process.platform !== 'win32',
    });
    this.exitPromise = new Promise(resolve => this.child.once('close', () => resolve()));
    this.child.on('error', error => this.fail(error));
    this.child.on('close', (code, signal) => this.fail(new Error(`Codex process closed (${code ?? signal})`)));
    this.child.stdin.on('error', error => this.fail(error));
    // Drain stderr without retaining potentially sensitive runtime diagnostics.
    this.child.stderr.on('data', () => {});
    this.child.stdout.on('data', (bytes: Buffer) => {
      this.buffer += this.decoder.write(bytes);
      const max = this.options.maxMessageBytes ?? 8 * 1024 * 1024;
      for (;;) {
        const end = this.buffer.indexOf('\n');
        if (end < 0) break;
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (Buffer.byteLength(line) > max) return this.protocolFailure('Oversized RPC message');
        if (line.trim()) this.receive(line);
        if (this.ended) return;
      }
      if (Buffer.byteLength(this.buffer) > max) this.protocolFailure('Oversized RPC message');
    });
  }

  initialize(): Promise<unknown> {
    this.initializing ??= this.sendRequest('initialize', {
      clientInfo: { name: 'coagent', title: 'coAgent', version: '0.1.0-dev.1' },
      capabilities: { experimentalApi: false },
    }).then(result => {
      this.write({ method: 'initialized', params: {} });
      this.ready = true;
      return result;
    });
    return this.initializing;
  }

  async request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.ready) throw new Error('Initialize Codex before making requests');
    return this.sendRequest(method, params) as Promise<T>;
  }

  respond(id: number | string, result: unknown): void {
    if (!this.serverRequests.delete(id)) throw new Error('Unknown or already resolved server request');
    this.write({ id, result });
  }

  get pendingCount(): number { return this.pending.size; }

  get pid(): number | undefined { return this.child.pid; }

  async close(): Promise<void> {
    this.ready = false;
    this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = (ms: number) => new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ms); });
    if (await Promise.race([this.exitPromise.then(() => true), wait(1500)])) {
      clearTimeout(timer); return;
    }
    clearTimeout(timer);
    this.killTree('SIGTERM');
    if (!(await Promise.race([this.exitPromise.then(() => true), wait(1000)]))) this.killTree('SIGKILL');
    clearTimeout(timer);
    await this.exitPromise;
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (this.ended) return Promise.reject(new Error('Codex connection is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC request timed out: ${method}`));
      }, this.options.requestTimeoutMs ?? 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }

  private write(message: RpcMessage): void {
    if (this.ended || !this.child.stdin.writable) throw new Error('Codex connection is closed');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private receive(line: string): void {
    let message: RpcMessage;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      message = value as RpcMessage;
    } catch { return this.protocolFailure('Malformed RPC message'); }
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        if (typeof message.id !== 'string' && typeof message.id !== 'number') return this.protocolFailure('Invalid request ID');
        if (this.serverRequests.has(message.id)) return this.protocolFailure('Duplicate server request ID');
        this.serverRequests.add(message.id);
        this.emit('serverRequest', message);
      } else {
        this.emit('notification', message);
      }
      return;
    }
    if (typeof message.id !== 'number') return this.protocolFailure('Invalid RPC response ID');
    const request = this.pending.get(message.id);
    if (!request) return; // Late response after a bounded timeout.
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new RpcError(message.error.code, message.error.message));
    else request.resolve(message.result);
  }

  private protocolFailure(message: string): void {
    this.fail(new Error(message));
    this.killTree('SIGTERM');
  }

  private killTree(signal: NodeJS.Signals): void {
    if (!this.child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }

  private fail(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.ready = false;
    this.serverRequests.clear();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer); request.reject(error);
    }
    this.pending.clear();
    this.emit('closed', error);
  }
}
