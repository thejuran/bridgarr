import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeToken } from '@bridgarr/core';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

describe('server', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('responds to /healthz', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));

    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'bridgarr-youtube' });
  });

  it('returns 413 with a SAB-style body when the upload exceeds the size limit', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));
    // Buffer larger than the 1,000,000-byte fileSize limit — trips LIMIT_FILE_SIZE
    const oversizeBuffer = Buffer.alloc(1_000_001);

    const res = await request(app)
      .post('/api?mode=addfile')
      .attach('nzbfile', oversizeBuffer, 'big.nzb');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ status: false, error: 'Upload exceeds limit' });
  });

  it('returns 413 with a SAB-style body when more than one file is uploaded', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));
    // Two small files — trips multer files:1 limit (LIMIT_FILE_COUNT)

    const res = await request(app)
      .post('/api?mode=addfile')
      .attach('nzbfile', Buffer.alloc(10), 'a.nzb')
      .attach('nzbfile', Buffer.alloc(10), 'b.nzb');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ status: false, error: 'Upload exceeds limit' });
  });

  it('strips CR/LF/quote from the NZB Content-Disposition filename (CWE-113)', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));
    const token = encodeToken({
      provider: 'youtube',
      episodeId: 'abc',
      title: 'evil"\r\nX-Injected: yes',
      pageUrl: 'https://www.youtube.com/watch?v=abc',
    });

    const res = await request(app).get(`/nzb/${token}`);

    expect(res.status).toBe(200);
    const disposition = res.headers['content-disposition'];
    expect(disposition).toBe('attachment; filename="evilX-Injected: yes.nzb"');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    // No forged header leaked out of Content-Disposition.
    expect(res.headers['x-injected']).toBeUndefined();
  });
});
