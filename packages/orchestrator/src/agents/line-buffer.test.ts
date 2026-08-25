import { expect, test } from 'bun:test';
import { LineBuffer } from './types';

/**
 * The parent↔worker pipe is JSON lines in both directions. Everything that
 * matters here is the thing a naive `chunk.toString().split('\n')` gets wrong:
 * a chunk is not a line.
 */

const enc = new TextEncoder();

test('a line split across chunks is emitted once, whole', () => {
  const buf = new LineBuffer();
  expect(buf.push('{"type":"ans')).toEqual([]);
  expect(buf.push('wer","id":"t1"}\n')).toEqual(['{"type":"answer","id":"t1"}']);
});

test('several lines in one chunk all come out, in order', () => {
  const buf = new LineBuffer();
  expect(buf.push('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
});

test('a chunk carrying the tail of one line and the head of the next', () => {
  const buf = new LineBuffer();
  expect(buf.push('one\ntw')).toEqual(['one']);
  expect(buf.push('o\nthree')).toEqual(['two']);
  expect(buf.flush()).toEqual(['three']);
});

test('the unterminated tail is held back until flush', () => {
  const buf = new LineBuffer();
  expect(buf.push('{"kind":"done"}')).toEqual([]);
  expect(buf.flush()).toEqual(['{"kind":"done"}']);
  // Flushing twice does not repeat it — a `close` after an `end` is normal.
  expect(buf.flush()).toEqual([]);
});

test('blank lines are dropped rather than parsed', () => {
  const buf = new LineBuffer();
  expect(buf.push('a\n\n   \nb\n')).toEqual(['a', 'b']);
  expect(buf.flush()).toEqual([]);
});

test('a multi-byte character split across chunks survives', () => {
  const buf = new LineBuffer();
  const bytes = enc.encode('{"q":"café ☕"}\n');
  // Cut mid-way through the é (byte 10 of the encoded form).
  const split = 10;
  expect(buf.push(bytes.slice(0, split))).toEqual([]);
  expect(buf.push(bytes.slice(split))).toEqual(['{"q":"café ☕"}']);
});

test('CRLF leaves no carriage return on the line', () => {
  const buf = new LineBuffer();
  // trim() is what does it; the assertion is that a Windows-ish writer round
  // trips rather than producing unparseable JSON.
  expect(buf.push('{"ok":true}\r\n')).toEqual(['{"ok":true}']);
});
