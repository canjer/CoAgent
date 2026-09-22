import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { Obj } from '../../packages/model-gateway/src/chat-adapter.js';

export async function testServer(handler: (body: Obj, req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  const requests: Obj[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Obj;
      requests.push(body);
      await handler(body, req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  return {
    requests, baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      const done = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections(); await done;
    },
  };
}

export function responseEvents(item: Obj): Obj[] {
  const response = { id: 'resp_test', object: 'response', created_at: 1, model: 'coagent-test', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
  const events: Obj[] = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
  ];
  if (item.type === 'message') {
    const content = item.content as Obj[];
    events.push({ type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: content[0]?.text });
  }
  events.push({ type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response });
  return events.map((event, sequence_number) => ({ ...event, sequence_number }));
}
export function sendResponse(res: ServerResponse, item: Obj) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(responseEvents(item).map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}
export function assistant(text: string): Obj {
  return { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
}
export function sseStream(events: unknown[], terminal = true): ReadableStream<Uint8Array> {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (terminal ? 'data: [DONE]\n\n' : '');
  return new Response(body).body!;
}
