/**
 * Fake-NZB plumbing. The Newznab side hands Sonarr an enclosure URL pointing
 * at /nzb/<token>; the NZB served there embeds the token so that when Sonarr
 * uploads it to the SABnzbd side (addfile), we can recover what to download.
 */

export interface NzbPayload {
  provider: string;
  episodeId: string;
  /** Scene-format release title (no extension). */
  title: string;
  /** Watch-page URL yt-dlp can extract from. */
  pageUrl: string;
}

export function encodeToken(payload: NzbPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeToken(token: string): NzbPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid nzb token');
  }
  if (!isPayload(parsed)) throw new Error('invalid nzb token payload');
  return parsed;
}

function isPayload(value: unknown): value is NzbPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.provider === 'string' &&
    typeof v.episodeId === 'string' &&
    typeof v.title === 'string' &&
    typeof v.pageUrl === 'string'
  );
}

const META_RE = /<meta type="ytfortv">([A-Za-z0-9_-]+)<\/meta>/;

/** A minimal structurally-valid NZB carrying the payload in a head meta tag. */
export function buildNzb(payload: NzbPayload): string {
  const token = encodeToken(payload);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <head>
    <meta type="ytfortv">${token}</meta>
  </head>
  <file poster="ytfortv" date="0" subject="${escapeXml(payload.title)}">
    <groups>
      <group>alt.binaries.ytfortv</group>
    </groups>
    <segments>
      <segment bytes="1024" number="1">placeholder@ytfortv</segment>
    </segments>
  </file>
</nzb>
`;
}

/** Recover the payload from an NZB we generated. */
export function parseNzb(xml: string): NzbPayload {
  const token = xml.match(META_RE)?.[1];
  if (!token) throw new Error('not a ytfortv nzb');
  return decodeToken(token);
}

export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
