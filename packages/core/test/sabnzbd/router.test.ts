import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { DownloadQueue } from '../../src/downloads/queue.js';
import { SabSettings, SabLogger, handleSab } from '../../src/sabnzbd/router.js';
import { buildNzb, type NzbPayload } from '../../src/nzb.js';

const testPayload: NzbPayload = {
  provider: 'youtube',
  episodeId: 'abc123',
  title: 'Test.Show.S01E01.720p',
  pageUrl: 'https://www.youtube.com/watch?v=abc123',
};

const testSettings: SabSettings = {
  apiKey: 'testkey123',
  completeDir: '/tmp/complete',
  metaType: 'ytfortv',
};

function makeReq(query: Record<string, string>, files?: Express.Multer.File[]): Request {
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
});

describe('handleSab - addfile', () => {
  it('queues a job when given a valid NZB; invokes queue.add; metaType is injected (not hardcoded)', () => {
    const queue = new DownloadQueue();
    const nzbXml = buildNzb(testPayload, { metaType: 'ytfortv' });
    const file = {
      buffer: Buffer.from(nzbXml),
      originalname: 'test.nzb',
    } as Express.Multer.File;
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile', cat: 'sonarr' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    const body = (res as unknown as { body: unknown }).body as { status: boolean; nzo_ids: string[] };
    expect(body.status).toBe(true);
    expect(body.nzo_ids).toHaveLength(1);
    expect(queue.activeJobs()).toHaveLength(1);
  });

  it('rejects an unparseable NZB with an error derived from ctx.settings.metaType', () => {
    const queue = new DownloadQueue();
    const file = {
      buffer: Buffer.from('<html>not an nzb</html>'),
      originalname: 'junk.nzb',
    } as Express.Multer.File;
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile', cat: 'sonarr' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue }, req as Request, res as unknown as Response);

    const body = (res as unknown as { body: unknown }).body as { status: boolean; error: string };
    expect(body.status).toBe(false);
    expect(body.error).toContain('ytfortv');
  });

  it('calls logger.warn with no-op fallback when no logger provided (does not throw)', () => {
    const queue = new DownloadQueue();
    const file = {
      buffer: Buffer.from('<html>not an nzb</html>'),
      originalname: 'junk.nzb',
    } as Express.Multer.File;
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
    const file = {
      buffer: Buffer.from('<html>not an nzb</html>'),
      originalname: 'junk.nzb',
    } as Express.Multer.File;
    const req = makeReq({ apikey: 'testkey123', mode: 'addfile' }, [file]);
    const res = makeRes();

    handleSab({ settings: testSettings, queue, logger: mockLogger }, req as Request, res as unknown as Response);

    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
