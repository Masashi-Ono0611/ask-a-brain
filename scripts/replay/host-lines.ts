/** Bounded byte framing; decoding occurs only in strictJson after a whole line. */
export class HostLines {
  #pending = Buffer.alloc(0);
  readonly limit: number; readonly consume: (bytes: Buffer) => void;
  constructor(limit: number, consume: (bytes: Buffer) => void) { this.limit = limit; this.consume = consume; }
  push(chunk: Buffer): void {
    for (let start = 0; start < chunk.length;) {
      const n = chunk.indexOf(10, start), end = n < 0 ? chunk.length : n;
      if (this.#pending.length + end - start > this.limit) throw new Error('LINE_LIMIT');
      this.#pending = Buffer.concat([this.#pending, chunk.subarray(start, end)]);
      if (n < 0) break;
      const line = this.#pending; this.#pending = Buffer.alloc(0); this.consume(line); start = n + 1;
    }
  }
  end(): void { if (this.#pending.length) throw new Error('TRUNCATED_LINE'); }
}
