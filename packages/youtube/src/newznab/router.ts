import type { Request, Response } from 'express';
import type { Config } from '../config.js';
import type { VideoSource } from '../youtube/types.js';
import { capsXml, errorXml, searchRss } from './xml.js';

export interface AppContext {
  config: Config;
  source: VideoSource | null;
}

export async function handleNewznab(ctx: AppContext, req: Request, res: Response): Promise<void> {
  res.type('application/xml');

  if (param(req, 'apikey') !== ctx.config.settings.apiKey) {
    res.send(errorXml(100, 'Incorrect user credentials'));
    return;
  }

  switch (param(req, 't')) {
    case 'caps':
      res.send(capsXml({ title: 'YTforTV' }));
      return;
    // Interim stubs — YouTube-backed search lands with the naming layer.
    case 'search':
    case 'tvsearch':
    case 'movie':
      res.send(searchRss([]));
      return;
    default:
      res.send(errorXml(202, 'No such function'));
  }
}

function param(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}
