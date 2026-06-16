/**
 * Validates that `url` is safe to use as a download target.
 * Throws a descriptive Error on any violation:
 *   - unparseable URL
 *   - embedded credentials present (username or password)
 *   - protocol not in opts.protocols
 *   - host (www-stripped) not in opts.hosts
 * Returns the parsed URL on success so callers can reuse the normalized object.
 */
export function assertAllowedUrl(
  url: string,
  opts: { protocols: string[]; hosts: string[] },
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`URL must not contain credentials: ${parsed.hostname}`);
  }
  if (!opts.protocols.includes(parsed.protocol)) {
    throw new Error(`URL protocol not allowed: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (!opts.hosts.includes(host)) {
    throw new Error(`URL host not allowed: ${parsed.hostname}`);
  }
  return parsed;
}
