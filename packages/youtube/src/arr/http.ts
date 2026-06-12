/**
 * Shared HTTP plumbing for *arr (Sonarr/Radarr) v3 API clients: api-key
 * header, error-message extraction, and JSON-shape guards.
 */

export interface ArrHttpOptions {
  fetchFn?: typeof fetch;
}

export class ArrHttp {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    /** Service name used in error messages, e.g. "Sonarr". */
    private readonly service: string,
    baseUrl: string,
    apiKey: string,
    options: ArrHttpOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = { 'X-Api-Key': this.apiKey };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchFn(`${this.baseUrl}/api/v3${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`${this.service} ${res.status}: ${await errorDetail(res)}`);
    return res.json();
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface QualityProfile {
  id: number;
  name: string;
}

export interface RootFolder {
  path: string;
}

export function parseQualityProfiles(data: unknown): QualityProfile[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (p): p is { id: number; name: string } =>
        isRecord(p) && typeof p.id === 'number' && typeof p.name === 'string',
    )
    .map((p) => ({ id: p.id, name: p.name }));
}

export function parseRootFolders(data: unknown): RootFolder[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((f): f is { path: string } => isRecord(f) && typeof f.path === 'string')
    .map((f) => ({ path: f.path }));
}

/**
 * Human-readable message from an *arr error body. Validation failures arrive
 * as [{ errorMessage }], other errors as { message } or plain text.
 */
async function errorDetail(res: Response): Promise<string> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    // body unreadable; fall through to statusText
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const messages = parsed
        .map((e) => (isRecord(e) && typeof e.errorMessage === 'string' ? e.errorMessage : null))
        .filter((m): m is string => m !== null);
      if (messages.length > 0) return messages.join(' ');
    } else if (isRecord(parsed) && typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    // not json
  }
  return text.slice(0, 200) || res.statusText;
}
