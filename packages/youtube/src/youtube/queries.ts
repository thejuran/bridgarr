/**
 * YouTube search variants for a TV episode, in priority order. Uploaders
 * label episodes inconsistently (S01E02, 1x02, "season 1 episode 2", or not
 * at all), so several phrasings are fanned out and merged.
 */
export function buildTvQueries(title: string, season: number, episode: number): string[] {
  const ss = String(season).padStart(2, '0');
  const ee = String(episode).padStart(2, '0');
  return [
    `${title} S${ss}E${ee}`,
    `${title} season ${season} episode ${episode}`,
    `${title} ${season}x${ee}`,
    `${title} full episode`,
  ];
}

/** YouTube search variants for a movie, in priority order. */
export function buildMovieQueries(title: string, year?: number | null): string[] {
  if (!year) return [`${title} full movie`];
  return [`${title} ${year} full movie`, `${title} full movie`, `${title} ${year}`];
}
