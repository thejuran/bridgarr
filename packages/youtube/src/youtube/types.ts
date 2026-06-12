/** A YouTube video as surfaced by flat search — everything the bridge needs. */
export interface YtVideo {
  videoId: string;
  uploadTitle: string;
  channel: string;
  durationSec: number;
  viewCount: number | null;
  /** Watch-page URL yt-dlp can download from. */
  pageUrl: string;
}

/** Search abstraction the Newznab layer talks to; implemented by the yt-dlp provider. */
export interface VideoSource {
  searchTv(title: string, season?: number, episode?: number): Promise<YtVideo[]>;
  searchMovie(title: string, year?: number): Promise<YtVideo[]>;
}
