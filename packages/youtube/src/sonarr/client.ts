import {
  ArrHttp,
  isRecord,
  parseQualityProfiles,
  parseRootFolders,
  type QualityProfile,
  type RootFolder,
} from '../arr/http.js';

export type { QualityProfile, RootFolder } from '../arr/http.js';

/**
 * Minimal Sonarr v3 API client for the browse UI's "Add to Sonarr" flow.
 * Lookup results are passed back to POST /series verbatim (plus the add
 * fields), so unknown payload fields are preserved.
 */

export interface SonarrSeries {
  /** Present (> 0) only when the series is already in the Sonarr library. */
  id?: number;
  title?: string;
  year?: number;
  tvdbId: number;
  network?: string;
  overview?: string;
  [key: string]: unknown;
}

export interface AddSeriesOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  /** Sonarr monitor mode: "all", "future", "none", ... */
  monitor: string;
  searchForMissingEpisodes: boolean;
}

export interface SonarrClientOptions {
  fetchFn?: typeof fetch;
}

export class SonarrClient {
  private readonly http: ArrHttp;

  constructor(baseUrl: string, apiKey: string, options: SonarrClientOptions = {}) {
    this.http = new ArrHttp('Sonarr', baseUrl, apiKey, options);
  }

  async lookup(term: string): Promise<SonarrSeries[]> {
    const data = await this.http.request(`/series/lookup?term=${encodeURIComponent(term)}`);
    return Array.isArray(data) ? data.filter(isSeries) : [];
  }

  async lookupByTvdbId(tvdbId: number): Promise<SonarrSeries | undefined> {
    const matches = await this.lookup(`tvdb:${tvdbId}`);
    return matches.find((s) => s.tvdbId === tvdbId) ?? matches[0];
  }

  async qualityProfiles(): Promise<QualityProfile[]> {
    return parseQualityProfiles(await this.http.request('/qualityprofile'));
  }

  async rootFolders(): Promise<RootFolder[]> {
    return parseRootFolders(await this.http.request('/rootfolder'));
  }

  async addSeries(series: SonarrSeries, options: AddSeriesOptions): Promise<void> {
    await this.http.request('/series', {
      method: 'POST',
      body: JSON.stringify({
        ...series,
        qualityProfileId: options.qualityProfileId,
        rootFolderPath: options.rootFolderPath,
        monitored: true,
        addOptions: {
          monitor: options.monitor,
          searchForMissingEpisodes: options.searchForMissingEpisodes,
        },
      }),
    });
  }
}

function isSeries(value: unknown): value is SonarrSeries {
  return isRecord(value) && typeof value.tvdbId === 'number' && typeof value.title === 'string';
}
