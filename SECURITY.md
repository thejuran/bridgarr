# Security Policy

## Trust model and intended deployment

**bridgarr-youtube is designed for LAN-only use.**

It runs on a local NAS alongside Sonarr, Radarr, and SABnzbd — all on the same private network. Its authentication model is identical to theirs in a default self-hosted deployment: the app relies on your LAN perimeter for isolation rather than built-in credentials. This is a deliberate design decision (D-02a), not a vulnerability.

Concretely:
- The Settings UI and the `/nzb` download endpoint are not auth-gated.
- The Newznab and SABnzbd emulation endpoints require an API key, which guards against casual cross-site calls.
- The SSRF guard (`assertYouTubeUrl`) restricts outbound HTTP to `youtube.com` / `youtu.be` over HTTPS only — the app cannot be used as an open proxy to other internal hosts.

**If you choose to expose bridgarr-youtube on a public IP or via a reverse proxy, you must add your own authentication layer** (e.g. Authelia, Authentik, nginx basic auth). Running it unauthenticated on the public internet is out of scope for this project's security model and unsupported.

## Scope

The following are in scope for responsible disclosure:

- SSRF guard bypass (the app being tricked into making HTTP requests to non-YouTube hosts)
- Secrets or API keys leaking into logs or HTTP responses
- Path traversal via user-controlled input (file paths, download directories)
- Authentication bypass if bridgarr-youtube is deployed with a reverse proxy auth layer (i.e. the app itself undermining an auth layer placed in front of it)
- Remote code execution or command injection via any user-controlled input

The following are **not** vulnerabilities in this project's model:

- The absence of built-in authentication (intentional LAN-only design, documented above)
- HTTP-only operation on the local network (no TLS by default, same as Sonarr/SABnzbd)
- YouTube content that is unauthorized or infringing (out of scope — legal question for the operator)

## Reporting a vulnerability

Please use [GitHub Security Advisories](https://github.com/thejuran/bridgarr/security/advisories/new) to report vulnerabilities privately. This keeps the disclosure confidential until a fix is available.

Include:
1. A description of the vulnerability and the affected component
2. Steps to reproduce
3. The potential impact
4. Any suggested mitigation (optional)

You will receive an acknowledgement within a few days. This is a small open-source project maintained by one person — response times may vary, but all credible reports will be addressed.

Do **not** open a public GitHub issue to report a security vulnerability before coordinating privately.
