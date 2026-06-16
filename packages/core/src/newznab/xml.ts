import { escapeXml } from '../nzb.js';

export function errorXml(code: number, description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<error code="${code}" description="${escapeXml(description)}"/>`;
}

export interface CapsOptions {
  title: string;
  /**
   * Optional parameterized categories (CORE-04). When omitted, renders
   * the default Newznab Movies(2000) + TV(5000) category blocks.
   */
  categories?: {
    movies?: Array<{ id: number; name: string }>;
    tv?: Array<{ id: number; name: string }>;
  };
}

function renderDefaultCategories(): string {
  return `    <category id="2000" name="Movies">
      <subcat id="2030" name="Movies/SD"/>
      <subcat id="2040" name="Movies/HD"/>
    </category>
    <category id="5000" name="TV">
      <subcat id="5030" name="TV/SD"/>
      <subcat id="5040" name="TV/HD"/>
    </category>`;
}

function renderCustomCategories(categories: NonNullable<CapsOptions['categories']>): string {
  const blocks: string[] = [];
  for (const cat of categories.movies ?? []) {
    blocks.push(`    <category id="${cat.id}" name="${escapeXml(cat.name)}">\n    </category>`);
  }
  for (const cat of categories.tv ?? []) {
    blocks.push(`    <category id="${cat.id}" name="${escapeXml(cat.name)}">\n    </category>`);
  }
  return blocks.join('\n');
}

export function capsXml(opts: CapsOptions): string {
  const cats =
    opts.categories === undefined
      ? renderDefaultCategories()
      : renderCustomCategories(opts.categories);
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
${cats}
  </categories>
</caps>`;
}

export interface ReleaseItem {
  title: string;
  /** Absolute URL of the fake-NZB download (used as guid + enclosure). */
  nzbUrl: string;
  /** Sonarr/Radarr surface this as the release's info link — the YouTube watch page. */
  commentsUrl?: string;
  sizeBytes: number;
  /** Sonarr rejects feeds where any item lacks a valid pubDate. */
  pubDate: Date;
  season: number | null;
  episode: number | null;
  categories: number[];
}

/**
 * Render the Newznab search RSS feed.
 *
 * @param items The release items to render.
 * @param title Channel `<title>` — the bridge's feed identity. Defaults to
 *   `'bridgarr'` (bridge-neutral); callers should pass their own name
 *   explicitly. The youtube bridge passes `'bridgarr-youtube'`.
 */
export function searchRss(items: ReleaseItem[], title = 'bridgarr'): string {
  const rendered = items.map(renderItem).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
<channel>
<title>${escapeXml(title)}</title>
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
  const comments = item.commentsUrl
    ? `\n<comments>${escapeXml(item.commentsUrl)}</comments>`
    : '';
  return `<item>
<title>${escapeXml(item.title)}</title>
<guid isPermaLink="true">${url}</guid>
<link>${url}</link>${comments}
<pubDate>${item.pubDate.toUTCString()}</pubDate>
<enclosure url="${url}" length="${item.sizeBytes}" type="application/x-nzb"/>
${attrs.join('\n')}
</item>`;
}
