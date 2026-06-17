import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { DownloadQueue } from '../../src/downloads/queue.js';
import type { SabSettings, SabLogger } from '../../src/sabnzbd/router.js';
import { handleSab } from '../../src/sabnzbd/router.js';
import { buildNzb, type NzbPayload } from '../../src/nzb.js';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
}

const testPayload: NzbPayload = {
  provider: 'youtube',
  episodeId: 'abc123',
  title: 'Test.Show.S01E01.720p',
  pageUrl: 'https://www.youtube.com/watch?v=abc123',
};

const testSettings: SabSettings = {
  apiKey: 'testkey123',
  completeDir: '/tmp/complete',
  metaType: 'bridgarr-youtube',
};

function makeReq(query: Record<string, string>, files?: UploadedFile[]): Request {
  return {
    query,
    params: {},
    files: files ?? [],
  } as unknown as Request;
}

function makeRes(): { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; body: unknown } {
  const res = {
    body: undefined as unknown,
    json: vi.fn((data: unknown) => { res.body = data; }),
    status: vi.fn(() => res),
  };
  return res as unknown as { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; body: unknown };
}

describe('handleSab - apikey auth', () => {
  it('rejects a request with the wrong apikey', () => {
    const queue = new DownloadQueue();
    const req = makeReq({ apikey: 'wrongkey', mode: 'version' });
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    expect(res.json).toHaveBeenCalledWith({ status: false, error: 'API Key Incorrect' });
  });

  it('accepts a request with the correct apikey (version mode)', () => {
    const queue = new DownloadQueue();
    const req = makeReq({ apikey: 'testkey123', mode: 'version' });
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    const body = (res as unknown as { body: unknown }).body as { version: string };
    expect(body.version).toMatch(/^\d+\./);
  });
});

describe('handleSab - get_config', () => {
  it('reports complete_dir from ctx.settings.completeDir', () => {
    const queue = new DownloadQueue();
    const req = makeReq({ apikey: 'testkey123', mode: 'get_config' });
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    const body = (res as unknown as { body: unknown }).body as { config: { misc: { complete_dir: string } } };
    expect(body.config.misc.complete_dir).toBe('/tmp/complete');
  });

  it('reports completed-download retention so Sonarr health check passes (SONR-01)', () => {
    // Contract verified against Sonarr Sabnzbd.cs RemovesCompletedDownloads (develop, lines 538-571):
    //   history_retention_option: 'all' → modern Sonarr v4.3+ switch case returns false (downloads retained)
    //   history_retention: '0'          → legacy path: "0" != "0" === false (downloads retained)
    //   history_retention_number: 0     → int field Sonarr model expects; inert when option='all'
    const queue = new DownloadQueue();
    const req = makeReq({ apikey: 'testkey123', mode: 'get_config' });
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    const body = (res as unknown as { body: unknown }).body as {
      config: { misc: Record<string, unknown> };
    };
    const misc = body.config.misc;

    // modern Sonarr v4.3+: switch(option) { case 'all': return false; } → retained
    expect(misc.history_retention_option).toBe('all');
    // legacy Sonarr (v3, v4.0–v4.2): retention != "0" → false → retained
    expect(misc.history_retention).toBe('0');
    // int model field; inert when option==='all'
    expect(misc.history_retention_number).toBe(0);
    // complete_dir still present and unchanged
    expect(misc.complete_dir).toBe('/tmp/complete');

    // Minimal scope: ONLY these four fields in misc (D-09 — no speculative additions)
    expect(Object.keys(misc).sort()).toEqual(
      ['complete_dir', 'history_retention', 'history_retention_number', 'history_retention_option'].sort(),
    );
  });
});

describe('handleSab - addfile', () => {
  it('queues a job when given a valid NZB; invokes queue.add; metaType is injected (not hardcoded)', () => {
    const queue = new DownloadQueue();
    const nzbXml = buildNzb(testPayload, { metaType: 'bridgarr-youtube' });
    const file: UploadedFile = {
      buffer: Buffer.from(nzbXml),
      originalname: 'test.nzb',
    };
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile', cat: 'sonarr' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    const body = (res as unknown as { body: unknown }).body as { status: boolean; nzo_ids: string[] };
    expect(body.status).toBe(true);
    expect(body.nzo_ids).toHaveLength(1);
    expect(queue.activeJobs()).toHaveLength(1);
  });

  it('sanitizes a path-traversal cat= to the default (would otherwise escape completeDir, CWE-22)', () => {
    const queue = new DownloadQueue();
    const nzbXml = buildNzb(testPayload, { metaType: 'bridgarr-youtube' });
    const file: UploadedFile = { buffer: Buffer.from(nzbXml), originalname: 'test.nzb' };
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile', cat: '../../tmp/evil' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    // The runner builds path.join(completeDir, job.category); an unchecked cat would
    // escape completeDir. The category must fall back to the allowlisted default.
    expect(queue.activeJobs()[0]!.category).toBe('sonarr');
  });

  it('preserves a cat= value that is on the allowlist', () => {
    const queue = new DownloadQueue();
    const nzbXml = buildNzb(testPayload, { metaType: 'bridgarr-youtube' });
    const file: UploadedFile = { buffer: Buffer.from(nzbXml), originalname: 'test.nzb' };
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile', cat: 'radarr' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    expect(queue.activeJobs()[0]!.category).toBe('radarr');
  });

  it('rejects an unparseable NZB with an error derived from ctx.settings.metaType', () => {
    const queue = new DownloadQueue();
    const file: UploadedFile = {
      buffer: Buffer.from('<html>not an nzb</html>'),
      originalname: 'junk.nzb',
    };
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile', cat: 'sonarr' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    const body = (res as unknown as { body: unknown }).body as { status: boolean; error: string };
    expect(body.status).toBe(false);
    expect(body.error).toContain('bridgarr-youtube');
  });

  it('calls logger.warn with no-op fallback when no logger provided (does not throw)', () => {
    const queue = new DownloadQueue();
    const file: UploadedFile = {
      buffer: Buffer.from('<html>not an nzb</html>'),
      originalname: 'junk.nzb',
    };
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile' }, [file]);
    const res = makeRes();

    // No logger provided — should not throw
    expect(() =>
      handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response),
    ).not.toThrow();
  });

  it('calls injected logger.warn when NZB is invalid', () => {
    const queue = new DownloadQueue();
    const warnSpy = vi.fn();
    const mockLogger: SabLogger = { warn: warnSpy, info: vi.fn() };
    const file: UploadedFile = {
      buffer: Buffer.from('<html>not an nzb</html>'),
      originalname: 'junk.nzb',
    };
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue, logger: mockLogger }, req as Request, res as unknown as Response);

    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
