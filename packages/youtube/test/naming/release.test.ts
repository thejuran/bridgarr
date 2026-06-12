import { describe, expect, it } from 'vitest';
import {
  movieReleaseName,
  sanitizeChannel,
  sanitizeUploadTitle,
  tvReleaseName,
} from '../../src/naming/release.js';

// Upload titles below marked "real" are verbatim from recorded yt-dlp
// flat-search fixtures (fixtures/youtube/).

describe('sanitizeUploadTitle', () => {
  it('strips a leading repeat of the show title', () => {
    // real
    const out = sanitizeUploadTitle('Rumpole of the Bailey S1E2  the alternative society', {
      showTitle: 'Rumpole of the Bailey',
    });
    expect(out).toBe('the.alternative.society');
  });

  it('strips embedded episode markers that would hijack the parser', () => {
    for (const title of [
      'Show S5E5 Portia',
      'Show S05 E05 Portia',
      'Show 5x05 Portia',
      'Show season 5 episode 5 Portia',
      'Show Episode 5 Portia',
      'Show Ep. 5 Portia',
    ]) {
      const out = sanitizeUploadTitle(title, { showTitle: 'Show' });
      expect(out).toBe('Portia');
    }
  });

  it('keeps "Part N" — informative and not parsed as numbering', () => {
    expect(sanitizeUploadTitle('The Lost Special Part 2')).toBe('The.Lost.Special.Part.2');
  });

  it('strips quality lies so the name cannot overpromise', () => {
    // real
    const out = sanitizeUploadTitle('The Mouse That Roared 1959 1080p WEBRip x264 AAC YTS MX', {
      showTitle: 'The Mouse That Roared',
      stripYears: true,
    });
    expect(out).toBe('');
  });

  it('strips bracketed marker + Full HD from a messy real title', () => {
    // real
    const out = sanitizeUploadTitle(
      '[Support Ukraine Now] Jeeves And Wooster — The Ties That Bind (S04E06) [Full HD] [subtitles]',
      { showTitle: 'Jeeves and Wooster' },
    );
    expect(out).not.toMatch(/S04E06/i);
    expect(out).not.toMatch(/hd/i);
    expect(out).toContain('The.Ties.That.Bind');
  });

  it('removes date-shaped sequences that would trigger the daily parser', () => {
    expect(sanitizeUploadTitle('News Special 2020.06.10 extended')).toBe('News.Special.extended');
    expect(sanitizeUploadTitle('News Special 10/06/2020 extended')).not.toMatch(/\d{4}\.\d/);
  });

  it('strips years only in movie mode', () => {
    expect(sanitizeUploadTitle('Classic Drama 1978 restoration')).toContain('1978');
    expect(sanitizeUploadTitle('Classic Drama 1978 restoration', { stripYears: true })).toBe(
      'Classic.Drama.restoration',
    );
  });

  it('caps the segment at 60 chars on a dot boundary', () => {
    const out = sanitizeUploadTitle('word '.repeat(40));
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('.')).toBe(false);
    expect(out).toMatch(/^word(\.word)*$/);
  });
});

describe('sanitizeChannel', () => {
  it('collapses to a dash-safe alphanumeric group token', () => {
    expect(sanitizeChannel('o p i u m 2')).toBe('opium2'); // real channel
    expect(sanitizeChannel('Timeless TV & Film')).toBe('TimelessTVFilm'); // real channel
  });

  it('caps at 20 chars and survives empty input', () => {
    expect(sanitizeChannel('A'.repeat(50))).toHaveLength(20);
    expect(sanitizeChannel('')).toBe('');
    expect(sanitizeChannel('日本語のみ')).toBe('');
  });
});

describe('tvReleaseName', () => {
  const base = {
    showTitle: 'Rumpole of the Bailey',
    season: 1,
    episode: 2,
    uploadTitle: 'Rumpole of the Bailey S1E2  the alternative society', // real
    channel: 'o p i u m 2', // real
    durationSec: 3099,
    quality: '480p',
  };

  it('stamps the requested numbering and embeds upload title, duration, channel', () => {
    expect(tvReleaseName(base)).toBe(
      'Rumpole.of.the.Bailey.S01E02.YT.the.alternative.society.52min.480p.WEB-DL-opium2',
    );
  });

  it('contains exactly one episode marker even when the upload disagrees', () => {
    const name = tvReleaseName({
      ...base,
      uploadTitle: 'Rumpole of the Bailey S5E5  Portia', // real
    });
    expect(name).toContain('S01E02');
    expect(name).not.toMatch(/S0?5\s*E0?5/i);
  });

  it('keeps a disambiguation year in the show segment for series mapping', () => {
    const name = tvReleaseName({
      ...base,
      showTitle: 'Bluey 2018',
      searchTitle: 'Bluey',
      uploadTitle: 'Bluey full episode compilation',
    });
    expect(name).toMatch(/^Bluey\.2018\.S01E02\.YT\./);
  });

  it('omits the group dash when the channel sanitizes to nothing', () => {
    const name = tvReleaseName({ ...base, channel: '★★★' });
    expect(name.endsWith('WEB-DL')).toBe(true);
    expect(name).not.toContain('WEB-DL-');
  });

  it('drops the upload segment when sanitizing leaves nothing', () => {
    const name = tvReleaseName({ ...base, uploadTitle: 'Rumpole of the Bailey S01E02' });
    expect(name).toBe('Rumpole.of.the.Bailey.S01E02.YT.52min.480p.WEB-DL-opium2');
  });

  it('keeps the whole name within the filename budget', () => {
    const name = tvReleaseName({
      ...base,
      uploadTitle: `Rumpole of the Bailey ${'very long descriptive words '.repeat(10)}`,
    });
    expect(name.length).toBeLessThanOrEqual(140);
    expect(name).toContain('S01E02');
    expect(name).toContain('480p.WEB-DL');
  });
});

describe('movieReleaseName', () => {
  const base = {
    title: 'The Mouse That Roared',
    year: 1959,
    uploadTitle:
      'The Mouse That Roared (1959) Peter Sellers, Jean Seberg - FULL MOVIE - NO CUTS', // real
    channel: 'Classic Films',
    durationSec: 4980,
    quality: '480p',
  };

  it('stamps title + requested year and strips upload-title years', () => {
    const name = movieReleaseName(base);
    expect(name).toMatch(/^The\.Mouse\.That\.Roared\.1959\.YT\./);
    expect(name).toContain('FULL.MOVIE');
    expect(name).toContain('83min.480p.WEB-DL-ClassicFilms');
    // the only year is the stamped one
    expect(name.match(/(?:19|20)\d{2}/g)).toEqual(['1959']);
  });

  it('omits the year segment when unknown', () => {
    const name = movieReleaseName({ ...base, year: null });
    expect(name).toMatch(/^The\.Mouse\.That\.Roared\.YT\./);
  });
});
