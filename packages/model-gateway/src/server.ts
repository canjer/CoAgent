import {chatProfileOptions} from './chat-profile.js';
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import {writeGatewayAudit} from './audit.js';
import { timingSafeEqual,randomUUID,createHash } from 'node:crypto';
import { once } from 'node:events';
import { namespaceTools, chatToResponses, CompatibilityError, object, toChatRequest, type Obj } from './chat-adapter.js';
import { classifyProviderStatus } from './provider-error.js';

export interface GatewayOptions {
  token: string;
  provider: {
    protocol: 'responses' | 'chat-completions';
    baseUrl: string;
    apiKey?: string;
    upstreamModel: string;
    alias: string;
  };
  timeoutMs?: number;
  auditDirectory?: string;
  auditContext?: () => {workspaceHash?: string; threadId?: string; turnId?: string};
  onDiagnostic?: (event: string) => void;
}

async function readBody(req: IncomingMessage): Promise<Obj> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 2 * 1024 * 1024) throw new CompatibilityError('Request body exceeds limit');
    chunks.push(bytes);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) {
    if (error instanceof CompatibilityError) throw error;
    throw new CompatibilityError('Invalid JSON request');
  }
}

async function write(res: ServerResponse, chunk: string | Uint8Array): Promise<void> {
  if (res.destroyed) throw new Error('Client disconnected');
  if (res.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); res.off('error', onError); };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('Client disconnected')); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    res.once('drain', onDrain); res.once('close', onClose); res.once('error', onError);
  });
}

export async function startGateway(options: GatewayOptions) {
  if (options.token.length < 24) throw new Error('Gateway token must have at least 24 characters');
  const base = new URL(options.provider.baseUrl);
  if (base.username || base.password || base.search || base.hash) throw new Error('Base URL must not contain credentials, query or fragment');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) throw new Error('Use HTTPS except for local model services');
  const gatewaySessionId=randomUUID();
  const providerFingerprint=createHash('sha256').update(JSON.stringify(options.provider.protocol+':'+options.provider.baseUrl+':'+options.provider.upstreamModel)).digest('hex');
  const controllers = new Set<AbortController>();
  const server = createServer(async (req, res) => {
    options.onDiagnostic?.('request');
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
    res.on('close', () => controller.abort());
    const json = (status: number, message: string, details: Obj = {}) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message, ...details } }));
    };
    const requestId=randomUUID();const started=performance.now();
    let audited=false, resultWritten=false, upstreamStatus:number|undefined;
    let context:{workspaceHash?:string;threadId?:string;turnId?:string}={};
    const audit=async(phase:'intent'|'result',outcome:string)=>{
      if(!options.auditDirectory)return;
      await writeGatewayAudit(options.auditDirectory,requestId,phase,{version:1,time:new Date().toISOString(),gatewaySessionId,requestId,providerFingerprint,protocol:options.provider.protocol,context,phase,outcome,...(phase==='result'?{durationMs:Math.round(performance.now()-started),upstreamStatus}:{}),capture:'metadata-only'});
    };
    try {
      const actual = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from('Bearer ' + options.token);
      if (req.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        req.resume(); json(401, 'Invalid local gateway credentials'); return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/responses') { req.resume(); json(404, 'Unknown endpoint'); return; }
      const input = await readBody(req);
      if (input.model !== options.provider.alias) throw new CompatibilityError('Unknown model alias');
      const chat = options.provider.protocol === 'chat-completions';
      const mapped=chat?namespaceTools(input):null;
      const body = chat ? {...toChatRequest(mapped!.input, options.provider.upstreamModel, 'codex-text'),...chatProfileOptions(options.provider.baseUrl,options.provider.upstreamModel)} : { ...input, model: options.provider.upstreamModel };
      const url = new URL(base.toString().replace(/\/$/, '') + (chat ? '/chat/completions' : '/responses'));
      const supplied=options.auditContext?.()??{};
      context=Object.fromEntries(Object.entries(supplied).filter(([k,v])=>['workspaceHash','threadId','turnId'].includes(k)&&typeof v==='string').map(([k,v])=>[k,String(v).slice(0,128)]));
      await audit('intent','prepared');audited=true;
      controller.signal.throwIfAborted();
      const upstream = await fetch(url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(options.provider.apiKey ? { authorization: 'Bearer ' + options.provider.apiKey } : {}) },
        body: JSON.stringify(body),
      });
      upstreamStatus=upstream.status;
      options.onDiagnostic?.('upstream-status:' + upstream.status);
      if (!upstream.ok) {
        await upstream.body?.cancel();
        // Do not echo provider bodies: they can contain secrets, request content or private URLs.
        await audit('result','provider-error');resultWritten=true;
        json(upstream.status, `Model provider returned HTTP ${upstream.status}`, classifyProviderStatus(upstream.status)); return;
      }
      if (!upstream.body) throw new Error('Model provider returned no body');
      if (chat) {
        if (!upstream.headers.get('content-type')?.includes('text/event-stream')) {
          await upstream.body.cancel(); throw new Error('Expected upstream SSE stream');
        }
        // Validate unsupported request fields before headers; stream errors use response.failed.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for await (const event of chatToResponses(upstream.body, options.provider.alias,{toolNames:mapped!.names,allowToolStop:chatProfileOptions(options.provider.baseUrl,options.provider.upstreamModel).enable_thinking===false})) {
          await write(res, `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      } else {
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-cache' });
        for await (const chunk of upstream.body) await write(res, chunk);
      }
      await audit('result','transport-completed');resultWritten=true;
      res.end();
    } catch (error) {
      options.onDiagnostic?.('error:' + (error instanceof Error ? error.name : 'unknown'));
      if(audited&&!resultWritten){try{await audit('result',controller.signal.aborted?'cancelled-or-timeout':'failed');resultWritten=true;}catch{options.onDiagnostic?.('audit-write-failed');}}
      if (res.destroyed) return;
      const message = error instanceof CompatibilityError ? error.message : controller.signal.aborted ? 'Model request cancelled or timed out' : 'Model stream failed';
      if (res.headersSent) {
        res.end(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: { status: 'failed', error: { code: 'gateway_error', message } } })}\n\n`);
      } else json(error instanceof CompatibilityError ? 422 : 502, message);
    } finally {
      clearTimeout(timer); controllers.delete(controller);
    }
  });
  server.requestTimeout = options.timeoutMs ?? 60000;
  server.headersTimeout = Math.min(10000, server.requestTimeout);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing gateway address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      for (const controller of controllers) controller.abort();
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
