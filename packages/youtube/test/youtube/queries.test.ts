import { describe, expect, it } from 'vitest';
import { buildMovieQueries, buildTvQueries } from '../../src/youtube/queries.js';

describe('buildTvQueries', () => {
  it('produces the four variants in priority order with zero-padding', () => {
    expect(buildTvQueries('Rumpole of the Bailey', 1, 2)).toEqual([
      'Rumpole of the Bailey S01E02',
      'Rumpole of the Bailey season 1 episode 2',
      'Rumpole of the Bailey 1x02',
      'Rumpole of the Bailey full episode',
    ]);
  });

  it('keeps two-digit season/episode numbers unpadded', () => {
    const queries = buildTvQueries('Doctor Who', 12, 10);
    expect(queries[0]).toBe('Doctor Who S12E10');
    expect(queries[1]).toBe('Doctor Who season 12 episode 10');
    expect(queries[2]).toBe('Doctor Who 12x10');
  });
});

describe('buildMovieQueries', () => {
  it('includes year variants when the year is known', () => {
    expect(buildMovieQueries('The Mouse That Roared', 1959)).toEqual([
      'The Mouse That Roared 1959 full movie',
      'The Mouse That Roared full movie',
      'The Mouse That Roared 1959',
    ]);
  });

  it('falls back to a single query without a year', () => {
    expect(buildMovieQueries('The Mouse That Roared')).toEqual([
      'The Mouse That Roared full movie',
    ]);
  });
});
