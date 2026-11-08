/**
 * The same response, with `done` called once, when its body has been sent to the end, or the
 * client went away, or the body failed. What a tool call came to is known only then: the MCP SDK
 * can hand back an event stream that is still being written (it does on the 2025 handshake, which
 * ignores `responseMode: 'json'`), so a log line written when the response is returned would miss
 * every call that has to read calendars first.
 */
export function whenSent(response: Response, done: () => void, headers: HeadersInit = response.headers): Response {
  let called = false;
  const finish = () => {
    if (called) return;
    called = true;
    done();
  };
  const init = { status: response.status, statusText: response.statusText, headers };
  if (!response.body) {
    finish();
    return new Response(null, init);
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          finish();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  return new Response(body, init);
}
