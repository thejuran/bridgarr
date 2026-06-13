import { describe, expect, it } from 'vitest';
import { buildNzb, decodeToken, encodeToken, parseNzb, type NzbPayload } from '../src/nzb.js';

const opts = { metaType: 'ytfortv' };

const payload: NzbPayload = {
  provider: 'youtube',
  episodeId: 'dQw4w9WgXcQ',
  title: 'Bluey.S01E01.The.Magic.Xylophone.1080p.WEB-DL',
  pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};

describe('token encoding', () => {
  it('roundtrips a payload', () => {
    expect(decodeToken(encodeToken(payload))).toEqual(payload);
  });

  it('produces URL-safe tokens', () => {
    expect(encodeToken(payload)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects garbage tokens', () => {
    expect(() => decodeToken('not-a-token')).toThrow();
    expect(() => decodeToken(Buffer.from('{"junk":1}').toString('base64url'))).toThrow();
  });
});

describe('NZB roundtrip', () => {
  it('builds a valid NZB carrying the payload and parses it back', () => {
    const xml = buildNzb(payload, opts);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">');
    expect(xml).toContain('<segment');
    expect(parseNzb(xml, opts)).toEqual(payload);
  });

  it('rejects XML without a ytfortv meta tag', () => {
    expect(() => parseNzb('<?xml version="1.0"?><nzb></nzb>', opts)).toThrow('not a ytfortv nzb');
  });
});
