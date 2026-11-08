import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { expect, test } from '@playwright/test';
import * as z from 'zod/v4';
import { whenSent } from '../../lib/server/ai/sent';

// The one line /mcp logs for each request (app/mcp/route.ts) says what each tool call came to. It
// can only say so once the answer has been sent: on the 2025 handshake the SDK hands back an event
// stream that is still being written, whatever `responseMode` says. Found by the MCP Inspector run:
// successful calls, and refusals that come after reading the calendars, were missing from the log.

/** The real SDK handler, with one tool that takes a moment, as reading calendars does. */
function slowServer(entries: string[]) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: 'test', version: '1.0.0' });
      server.registerTool('slow', { inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        entries.push('slow:ok');
        return { content: [{ type: 'text', text: 'read' }] };
      });
      return server;
    },
    { responseMode: 'json' },
  );
}

const call = () =>
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slow', arguments: {} } }),
  });

test('the log line is written when the answer has been sent, so it has what the tool call came to', async () => {
  const entries: string[] = [];
  const handler = slowServer(entries);

  // Why: the SDK returns the response before the tool has finished. A line written now has nothing.
  const early = await handler.fetch(call());
  expect(entries).toEqual([]);
  await early.text();
  expect(entries).toEqual(['slow:ok']);
  entries.length = 0;

  // With whenSent, the line is written at the end of the answer, with the outcome in it.
  let logged: string[] | null = null;
  const sent = whenSent(await handler.fetch(call()), () => (logged = [...entries]), { 'cache-control': 'no-store' });
  expect(logged).toBeNull();
  expect(sent.headers.get('cache-control')).toBe('no-store');
  expect(await sent.text()).toContain('read');
  expect(logged).toEqual(['slow:ok']);
});

test('whenSent logs exactly once: no body, a body read to the end, a client that goes away, a body that fails', async () => {
  let count = 0;
  const done = () => void count++;

  const empty = whenSent(new Response(null, { status: 202 }), done);
  expect(count).toBe(1);
  expect(empty.status).toBe(202);

  count = 0;
  const whole = whenSent(new Response('a'.repeat(100_000), { status: 200 }), done);
  expect(count).toBe(0);
  expect((await whole.text()).length).toBe(100_000);
  expect(count).toBe(1);

  count = 0;
  let cancelled = false;
  const open = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new TextEncoder().encode('event: message\n')), cancel: () => void (cancelled = true) });
  const away = whenSent(new Response(open), done);
  const reader = away.body!.getReader();
  await reader.read();
  await reader.cancel('client went away');
  expect(cancelled).toBe(true);
  expect(count).toBe(1);

  count = 0;
  const broken = new ReadableStream<Uint8Array>({ pull: (c) => c.error(new Error('failed')) });
  await expect(whenSent(new Response(broken), done).text()).rejects.toThrow();
  expect(count).toBe(1);
});
