import { describe, expect, it } from 'vitest';
import { assertAllowedUrl } from '../src/url.js';

const YOUTUBE_OPTS = { protocols: ['https:'], hosts: ['youtube.com', 'youtu.be'] };

describe('assertAllowedUrl', () => {
  // Accept cases — table-driven over all allowed hosts with and without www.
  const acceptCases = [
    'https://youtube.com/watch?v=abc',
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://www.youtu.be/abc',
  ];

  for (const url of acceptCases) {
    it(`accepts ${url}`, () => {
      expect(() => assertAllowedUrl(url, YOUTUBE_OPTS)).not.toThrow();
    });
  }

  it('returns the parsed URL on success (instanceof URL)', () => {
    const result = assertAllowedUrl('https://youtube.com/watch?v=abc', YOUTUBE_OPTS);
    expect(result).toBeInstanceOf(URL);
  });

  // Reject cases — protocol
  it('rejects http:// (protocol not allowed)', () => {
    expect(() => assertAllowedUrl('http://youtube.com/watch?v=abc', YOUTUBE_OPTS)).toThrow('protocol not allowed');
  });

  it('rejects file://', () => {
    expect(() => assertAllowedUrl('file:///etc/passwd', YOUTUBE_OPTS)).toThrow();
  });

  it('rejects ftp:// (protocol not allowed)', () => {
    expect(() => assertAllowedUrl('ftp://youtube.com/x', YOUTUBE_OPTS)).toThrow('protocol not allowed');
  });

  // Reject cases — host
  it('rejects an unallowlisted host (host not allowed)', () => {
    expect(() => assertAllowedUrl('https://evil.com/video', YOUTUBE_OPTS)).toThrow('host not allowed');
  });

  // Reject cases — malformed
  it('rejects a non-URL string (Invalid URL)', () => {
    expect(() => assertAllowedUrl('not-a-url', YOUTUBE_OPTS)).toThrow('Invalid URL');
  });

  // Reject cases — credentials (HARD-02)
  it('rejects user:pass@ embedded credentials', () => {
    expect(() =>
      assertAllowedUrl('https://user:pass@youtube.com/watch?v=abc', YOUTUBE_OPTS),
    ).toThrow('credentials');
  });

  it('rejects username-only embedded credentials', () => {
    expect(() =>
      assertAllowedUrl('https://user@youtube.com/watch?v=abc', YOUTUBE_OPTS),
    ).toThrow('credentials');
  });
});
