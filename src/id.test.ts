import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './db';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = globalThis.crypto;

describe('new ids', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes UUIDs when the browser has crypto.randomUUID (HTTPS, localhost)', () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it('still makes unique UUIDs over plain http on the local network, where randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => realCrypto.getRandomValues(a as never) as T });
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
