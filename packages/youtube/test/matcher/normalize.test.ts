import { describe, expect, it } from 'vitest';
import {
  extractSearchYear,
  normalizeShowTitle,
  queryMatches,
  titlesMatch,
} from '../../src/matcher/normalize.js';

describe('extractSearchYear', () => {
  it('pulls a trailing year off a search query', () => {
    expect(extractSearchYear('Erskineville Kings 1999')).toBe(1999);
    expect(extractSearchYear('Fracture (2007)')).toBe(2007);
  });

  it('returns null when there is no trailing year', () => {
    expect(extractSearchYear('Fracture')).toBeNull();
    expect(extractSearchYear('Blade Runner 2049 ')).toBe(2049); // genuinely ambiguous; trailing wins
  });
});

describe('normalizeShowTitle', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeShowTitle('Hard  Quiz ')).toBe('hard quiz');
  });

  it('replaces & with and', () => {
    expect(normalizeShowTitle('Will & Grace')).toBe('will and grace');
  });

  it('strips diacritics', () => {
    expect(normalizeShowTitle('Pokémon')).toBe('pokemon');
  });

  it('removes apostrophes without splitting the word', () => {
    expect(normalizeShowTitle("Grandpa's Great Escape")).toBe('grandpas great escape');
    expect(normalizeShowTitle('Grandpa’s Great Escape')).toBe('grandpas great escape');
  });

  it('turns punctuation into single spaces', () => {
    expect(normalizeShowTitle('Mystery Road: Origin')).toBe('mystery road origin');
    expect(normalizeShowTitle('7.30')).toBe('7 30');
  });
});

describe('titlesMatch', () => {
  it('matches identical titles in different forms', () => {
    expect(titlesMatch('Hard Quiz', 'hard.quiz')).toBe(true);
    expect(titlesMatch('Will & Grace', 'Will and Grace')).toBe(true);
    expect(titlesMatch('7.30', '7 30')).toBe(true);
  });

  it('does not match a show against a longer title sharing a prefix', () => {
    expect(titlesMatch('Bluey', 'Bluey Tunes')).toBe(false);
  });

  it('ignores a trailing disambiguation year (Sonarr sends "Bluey 2018")', () => {
    expect(titlesMatch('bluey 2018', 'Bluey')).toBe(true);
    expect(titlesMatch('Bluey (2018)', 'Bluey')).toBe(true);
    // a year-only or year-bearing title still matches itself
    expect(titlesMatch('Bluey (2018)', 'bluey 2018')).toBe(true);
  });
});

describe('queryMatches', () => {
  it('matches when the query words appear in order in the title', () => {
    expect(queryMatches('bluey', 'Bluey')).toBe(true);
    expect(queryMatches('bluey', 'Bluey Tunes')).toBe(true);
    expect(queryMatches('hard quiz', 'Hard Quiz')).toBe(true);
  });

  it('does not match unrelated titles', () => {
    expect(queryMatches('bluey', 'Hard Quiz')).toBe(false);
  });

  it('treats an empty query as match-all', () => {
    expect(queryMatches('', 'Hard Quiz')).toBe(true);
  });
});
