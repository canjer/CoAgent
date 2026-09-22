/** Incremental UTF-8 SSE parser; supports split lines, CRLF, comments and multiline data. */
export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let eventBytes = 0;
  const limit = 4 * 1024 * 1024;
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (Buffer.byteLength(buffer) > limit) throw new Error('SSE frame exceeds limit');
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = []; eventBytes = 0;
        } else if (line.startsWith('data:')) {
          const value = line.slice(5).replace(/^ /, '');
          eventBytes += Buffer.byteLength(value);
          if (eventBytes > limit) throw new Error('SSE event exceeds limit');
          data.push(value);
        }
      }
      if (chunk.done) {
        if (buffer.trim() || data.length) throw new Error('Truncated SSE event');
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
