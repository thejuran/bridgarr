import { describe, expect, it } from 'vitest';
import { capsXml, errorXml, searchRss, type ReleaseItem } from '../../src/newznab/xml.js';

// ── capsXml default (no categories arg) ─────────────────────────────────────

describe('capsXml – default categories', () => {
  it('renders the default Movies(2000) block with subcat 2040', () => {
    const xml = capsXml({ title: 'bridgarr-youtube' });
    expect(xml).toContain('<category id="2000" name="Movies">');
    expect(xml).toContain('<subcat id="2040" name="Movies/HD"/>');
  });

  it('renders the default TV(5000) block with subcats 5030 and 5040', () => {
    const xml = capsXml({ title: 'bridgarr-youtube' });
    expect(xml).toContain('<category id="5000" name="TV">');
    expect(xml).toContain('<subcat id="5030" name="TV/SD"/>');
    expect(xml).toContain('<subcat id="5040" name="TV/HD"/>');
  });

  it('includes the supplied title in the server element', () => {
    const xml = capsXml({ title: 'MyBridge' });
    expect(xml).toContain('<server title="MyBridge"/>');
  });
});

// ── capsXml parameterized categories ────────────────────────────────────────

describe('capsXml – custom categories', () => {
  it('renders supplied tv categories instead of the default pair', () => {
    const xml = capsXml({
      title: 'X',
      categories: { tv: [{ id: 5040, name: 'TV/HD' }] },
    });
    // Custom tv category rendered
    expect(xml).toContain('<category id="5040" name="TV/HD">');
    // Default 5030/5040 pair NOT rendered as default blocks
    expect(xml).not.toContain('<category id="5030"');
    expect(xml).not.toContain('<category id="5000"');
    // Movies default not rendered when movies omitted
    expect(xml).not.toContain('<category id="2000"');
  });

  it('renders supplied movies categories when provided', () => {
    const xml = capsXml({
      title: 'X',
      categories: { movies: [{ id: 2010, name: 'Movies/Foreign' }] },
    });
    expect(xml).toContain('<category id="2010" name="Movies/Foreign">');
    expect(xml).not.toContain('<category id="2000"');
  });
});

// ── searchRss ────────────────────────────────────────────────────────────────

describe('searchRss', () => {
  const item: ReleaseItem = {
    title: 'Bluey.S01E01.1080p.WEB-DL',
    nzbUrl: 'http://localhost/nzb/abc123',
    sizeBytes: 500_000_000,
    pubDate: new Date('2024-01-01T00:00:00Z'),
    season: 1,
    episode: 1,
    categories: [5000, 5040],
  };

  it('renders the item title and nzb enclosure URL', () => {
    const xml = searchRss([item]);
    expect(xml).toContain('<title>Bluey.S01E01.1080p.WEB-DL</title>');
    expect(xml).toContain('enclosure url="http://localhost/nzb/abc123"');
  });

  it('applies escapeXml to titles containing special characters', () => {
    const special: ReleaseItem = { ...item, title: 'Tom & Jerry <1940>' };
    const xml = searchRss([special]);
    expect(xml).toContain('Tom &amp; Jerry &lt;1940&gt;');
    expect(xml).not.toContain('Tom & Jerry');
  });

  it('renders category newznab attrs for the item', () => {
    const xml = searchRss([item]);
    expect(xml).toContain('<newznab:attr name="category" value="5000"/>');
    expect(xml).toContain('<newznab:attr name="category" value="5040"/>');
  });
});

// ── errorXml ─────────────────────────────────────────────────────────────────

describe('errorXml', () => {
  it('renders the error code and description', () => {
    const xml = errorXml(100, 'Incorrect parameter');
    expect(xml).toContain('<error code="100" description="Incorrect parameter"/>');
  });

  it('escapes special characters in the description', () => {
    const xml = errorXml(200, 'Bad <input> & "quotes"');
    expect(xml).toContain('&lt;input&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
  });
});
