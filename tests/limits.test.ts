/**
 * §P2 hardening — byte caps and fetch-target safety on the paid ingestion path.
 *
 * Before this there was no byte cap ANYWHERE: analyze.ts gated only on duration and
 * Cloudflare's 100MB request limit was the sole backstop on uploads, while fetchVideo read a
 * resolved CDN URL with a bare, unbounded res.arrayBuffer(). Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LimitError, MAX_VIDEO_BYTES, MAX_VIDEO_MB,
  assertSafeFetchTarget, assertUploadWithinCap, readCappedBody,
} from '../worker/src/limits';

// ── upload cap ──

test('an upload under the cap passes', () => {
  assertUploadWithinCap(10 * 1024 * 1024);
  assertUploadWithinCap(MAX_VIDEO_BYTES);
});

test('an upload over the cap throws a 413 with an actionable message', () => {
  try {
    assertUploadWithinCap(MAX_VIDEO_BYTES + 1);
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof LimitError);
    assert.equal((e as LimitError).status, 413);
    assert.match((e as Error).message, new RegExp(`${MAX_VIDEO_MB}MB limit`));
    assert.match((e as Error).message, /Trim the clip/, 'must tell the operator what to do');
  }
});

test('the cap sits under Cloudflare’s 100MB request ceiling', () => {
  assert.ok(MAX_VIDEO_BYTES < 100 * 1024 * 1024);
  // …but comfortably above any real short-form clip (a 90s 4K clip is ~40MB).
  assert.ok(MAX_VIDEO_BYTES > 64 * 1024 * 1024);
});

// ── fetch-target safety ──

test('a normal public https CDN url passes', () => {
  const u = assertSafeFetchTarget('https://v16-webapp.tiktok.com/video/abc.mp4?x=1');
  assert.equal(u.hostname, 'v16-webapp.tiktok.com');
});

test('plain http passes (some CDNs still serve it)', () => {
  assert.doesNotThrow(() => assertSafeFetchTarget('http://cdn.example.com/a.mp4'));
});

for (const bad of [
  'file:///etc/passwd',
  'data:video/mp4;base64,AAAA',
  'ftp://example.com/a.mp4',
]) {
  test(`non-http(s) scheme is refused: ${bad.slice(0, 24)}`, () => {
    assert.throws(() => assertSafeFetchTarget(bad), /non-http\(s\)|not a valid URL/);
  });
}

for (const bad of [
  'http://localhost/a.mp4',
  'http://127.0.0.1/a.mp4',
  'http://169.254.169.254/latest/meta-data/',   // cloud metadata endpoint
  'http://10.0.0.5/a.mp4',
  'http://192.168.1.10/a.mp4',
  'http://172.16.5.4/a.mp4',
  'http://[::1]/a.mp4',
  'http://something.internal/a.mp4',
]) {
  test(`internal address is refused: ${bad}`, () => {
    assert.throws(() => assertSafeFetchTarget(bad), /internal address/);
  });
}

test('a PUBLIC address that merely looks adjacent to a private range still passes', () => {
  // 172.32.x is public — the RFC1918 block stops at 172.31. An over-broad regex would
  // silently break real CDNs, so this asserts the boundary.
  assert.doesNotThrow(() => assertSafeFetchTarget('http://172.32.0.1/a.mp4'));
  assert.doesNotThrow(() => assertSafeFetchTarget('http://11.0.0.1/a.mp4'));
});

test('a malformed url is refused as a 502, not a crash', () => {
  try {
    assertSafeFetchTarget('not a url at all');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof LimitError);
    assert.equal((e as LimitError).status, 502);
  }
});

// ── streaming cap ──

function bodyOf(bytes: number, declareLength: boolean, chunk = 64 * 1024): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= bytes) { c.close(); return; }
      const n = Math.min(chunk, bytes - sent);
      sent += n;
      c.enqueue(new Uint8Array(n));
    },
  });
  return new Response(stream, {
    headers: declareLength ? { 'content-length': String(bytes) } : {},
  });
}

test('readCappedBody returns the full body when under the cap', async () => {
  const buf = await readCappedBody(bodyOf(128 * 1024, true), MAX_VIDEO_BYTES);
  assert.equal(buf.byteLength, 128 * 1024);
});

test('readCappedBody rejects on Content-Length before reading any bytes', async () => {
  await assert.rejects(
    readCappedBody(bodyOf(MAX_VIDEO_BYTES + 1024, true), MAX_VIDEO_BYTES),
    /over the .*MB limit/,
  );
});

test('readCappedBody ALSO rejects when Content-Length is absent (chunked)', async () => {
  // The important case: trusting the header alone is how a "capped" download stays
  // uncapped. A chunked response declares nothing, so the stream itself must be counted.
  await assert.rejects(
    readCappedBody(bodyOf(3 * 1024 * 1024, false), 1024 * 1024),
    /exceeds the .*MB limit/,
  );
});

test('readCappedBody rejects a LYING Content-Length', async () => {
  // Declares 1KB, actually streams 3MB. Header-only checking would let it through.
  const res = new Response(bodyOf(3 * 1024 * 1024, false).body, {
    headers: { 'content-length': '1024' },
  });
  await assert.rejects(readCappedBody(res, 1024 * 1024), /exceeds the .*MB limit/);
});

test('readCappedBody handles an empty body', async () => {
  const buf = await readCappedBody(new Response(null), MAX_VIDEO_BYTES);
  assert.equal(buf.byteLength, 0);
});

test('readCappedBody reassembles multi-chunk bodies in order', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([1, 2, 3]));
      c.enqueue(new Uint8Array([4, 5]));
      c.close();
    },
  });
  const buf = await readCappedBody(new Response(stream), MAX_VIDEO_BYTES);
  assert.deepEqual([...new Uint8Array(buf)], [1, 2, 3, 4, 5]);
});
