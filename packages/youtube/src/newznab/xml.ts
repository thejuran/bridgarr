import { escapeXml } from '../nzb.js';

export function errorXml(code: number, description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<error code="${code}" description="${escapeXml(description)}"/>`;
}

export interface CapsOptions {
  title: string;
}

export function capsXml(opts: CapsOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="${escapeXml(opts.title)}"/>
  <limits max="100" default="100"/>
  <registration available="no" open="no"/>
  <searching>
    <search available="yes" supportedParams="q"/>
    <tv-search available="yes" supportedParams="q,season,ep"/>
    <movie-search available="yes" supportedParams="q"/>
  </searching>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2030" name="Movies/SD"/>
      <subcat id="2040" name="Movies/HD"/>
    </category>
    <category id="5000" name="TV">
      <subcat id="5030" name="TV/SD"/>
      <subcat id="5040" name="TV/HD"/>
    </category>
  </categories>
</caps>`;
}

export interface ReleaseItem {
  title: string;
  /** Absolute URL of the fake-NZB download (used as guid + enclosure). */
  nzbUrl: string;
  sizeBytes: number;
  /** Sonarr rejects feeds where any item lacks a valid pubDate. */
  pubDate: Date;
  season: number | null;
  episode: number | null;
  categories: number[];
}

export function searchRss(items: ReleaseItem[]): string {
  const rendered = items.map(renderItem).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
<channel>
<title>YTforTV</title>
<newznab:response offset="0" total="${items.length}"/>
${rendered}
</channel>
</rss>`;
}

function renderItem(item: ReleaseItem): string {
  const url = escapeXml(item.nzbUrl);
  const attrs = [
    ...item.categories.map((c) => `<newznab:attr name="category" value="${c}"/>`),
    `<newznab:attr name="size" value="${item.sizeBytes}"/>`,
  ];
  if (item.season !== null) attrs.push(`<newznab:attr name="season" value="${item.season}"/>`);
  if (item.episode !== null) attrs.push(`<newznab:attr name="episode" value="${item.episode}"/>`);
  return `<item>
<title>${escapeXml(item.title)}</title>
<guid isPermaLink="true">${url}</guid>
<link>${url}</link>
<pubDate>${item.pubDate.toUTCString()}</pubDate>
<enclosure url="${url}" length="${item.sizeBytes}" type="application/x-nzb"/>
${attrs.join('\n')}
</item>`;
}
