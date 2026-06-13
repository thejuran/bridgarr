import type { Request, Response } from 'express';

/**
 * Returns an Express GET handler that responds with a JSON health payload.
 *
 * @param serviceName - The service name included in the response body.
 *   The response is `{ status: 'ok', service: serviceName }`.
 */
export function healthzHandler(serviceName: string): (_req: Request, res: Response) => void {
  return (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: serviceName });
  };
}
