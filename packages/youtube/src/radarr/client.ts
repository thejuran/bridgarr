import {
  ArrHttp,
  isRecord,
  parseQualityProfiles,
  parseRootFolders,
  type QualityProfile,
  type RootFolder,
} from '../arr/http.js';

/**
 * Minimal Radarr v3 API client for the browse UI's "Add to Radarr" flow.
 * Lookup results are passed back to POST /movie verbatim (plus the add
 * fields), so unknown payload fields are preserved.
 */

export interface RadarrMovie {
  /** Present (> 0) only when the movie is already in the Radarr library. */
  id?: number;
  title?: string;
  year?: number;
  tmdbId: number;
  studio?: string;
  overview?: string;
  [key: string]: unknown;
}

export interface AddMovieOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  searchForMovie: boolean;
}

export interface RadarrClientOptions {
  fetchFn?: typeof fetch;
}

export class RadarrClient {
  private readonly http: ArrHttp;

  constructor(baseUrl: string, apiKey: string, options: RadarrClientOptions = {}) {
    this.http = new ArrHttp('Radarr', baseUrl, apiKey, options);
  }

  async lookup(term: string): Promise<RadarrMovie[]> {
    const data = await this.http.request(`/movie/lookup?term=${encodeURIComponent(term)}`);
    return Array.isArray(data) ? data.filter(isMovie) : [];
  }

  async lookupByTmdbId(tmdbId: number): Promise<RadarrMovie | undefined> {
    const matches = await this.lookup(`tmdb:${tmdbId}`);
    return matches.find((m) => m.tmdbId === tmdbId) ?? matches[0];
  }

  async qualityProfiles(): Promise<QualityProfile[]> {
    return parseQualityProfiles(await this.http.request('/qualityprofile'));
  }

  async rootFolders(): Promise<RootFolder[]> {
    return parseRootFolders(await this.http.request('/rootfolder'));
  }

  async addMovie(movie: RadarrMovie, options: AddMovieOptions): Promise<void> {
    await this.http.request('/movie', {
      method: 'POST',
      body: JSON.stringify({
        ...movie,
        qualityProfileId: options.qualityProfileId,
        rootFolderPath: options.rootFolderPath,
        monitored: true,
        // Everything on iView is already streamable, so "released" always holds.
        minimumAvailability: 'released',
        addOptions: { searchForMovie: options.searchForMovie },
      }),
    });
  }
}

function isMovie(value: unknown): value is RadarrMovie {
  return isRecord(value) && typeof value.tmdbId === 'number' && typeof value.title === 'string';
}
