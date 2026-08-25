import { expect, test } from 'bun:test';
import { type AttachedImage, MAX_IMAGES_PER_ANNOTATION } from '@iris/shared';
import { parseFollowUpMessage } from './server';

const IMG: AttachedImage = { name: 'shot.png', mediaType: 'image/png', dataBase64: 'aGk=' };

test('text-only body parses (older clients send nothing else)', () => {
  const parsed = parseFollowUpMessage({ text: '  hi  ' });
  expect(parsed).toEqual({ ok: true, text: 'hi', images: [] });
});

test('images ride along, with model and effort', () => {
  const parsed = parseFollowUpMessage({
    text: 'match this',
    model: 'claude-opus-5',
    reasoningEffort: 'high',
    images: [IMG],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.images).toEqual([IMG]);
  expect(parsed.model).toBe('claude-opus-5');
  expect(parsed.effort).toBe('high');
});

test('an image with no words is a legitimate message', () => {
  const parsed = parseFollowUpMessage({ text: '', images: [IMG] });
  expect(parsed.ok).toBe(true);
});

test('no words and no images is not', () => {
  expect(parseFollowUpMessage({ text: '   ' }).ok).toBe(false);
  expect(parseFollowUpMessage(null).ok).toBe(false);
});

test('malformed images fail loudly rather than being dropped', () => {
  const bad = parseFollowUpMessage({ text: 'hi', images: [{ mediaType: 'image/png' }] });
  expect(bad.ok).toBe(false);
  const wrongType = parseFollowUpMessage({ text: 'hi', images: 'nope' });
  expect(wrongType.ok).toBe(false);
});

test('the per-message image cap is enforced', () => {
  const over = Array.from({ length: MAX_IMAGES_PER_ANNOTATION + 1 }, () => IMG);
  expect(parseFollowUpMessage({ text: 'hi', images: over }).ok).toBe(false);
});

test('a bad model or effort is dropped, not fatal', () => {
  const parsed = parseFollowUpMessage({ text: 'hi', model: 42, reasoningEffort: 'infinite' });
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.model).toBeUndefined();
  expect(parsed.effort).toBeUndefined();
});
