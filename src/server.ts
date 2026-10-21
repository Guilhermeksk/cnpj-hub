import { createServer as createHttpServer, type Server, type ServerResponse } from 'node:http';
import { CnpjHub } from './client.js';
import { format, isValid, sanitize } from './cnpj.js';
import { AllProvidersFailedError, CnpjNotFoundError, InvalidCnpjError } from './errors.js';

export interface ServerOptions {
  /** Hub used to answer lookups. Default: `new CnpjHub()`. */
  hub?: CnpjHub;
  /** Value for `Access-Control-Allow-Origin`. Use `false` to omit CORS headers. Default: `*`. */
  cors?: string | false;
}

/**
 * Creates a tiny dependency-free HTTP API:
 *
 * - `GET /health`
 * - `GET /cnpj/:cnpj` — company data
 * - `GET /cnpj/:cnpj/validate` — structural validation, no network calls
 */
export function createServer(options: ServerOptions = {}): Server {
  const hub = options.hub ?? new CnpjHub();
  const cors = options.cors ?? '*';

  return createHttpServer(async (req, res) => {
    if (cors) {
      res.setHeader('access-control-allow-origin', cors);
      res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET, OPTIONS');
      return send(res, 405, { error: 'method_not_allowed', message: 'Use GET.' });
    }

    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    let segments: string[];
    try {
      segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return send(res, 400, { error: 'bad_request', message: 'URL malformada.' });
    }

    if (segments.length === 1 && segments[0] === 'health') {
      return send(res, 200, { status: 'ok' });
    }

    if (segments[0] === 'cnpj' && segments[1] && segments.length <= 3) {
      const input = segments[1];

      if (segments[2] === 'validate') {
        const valid = isValid(input);
        return send(res, 200, {
          input,
          valid,
          cnpj: valid ? sanitize(input) : null,
          formatted: valid ? format(input) : null,
        });
      }

      if (segments.length === 2) {
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        try {
          const company = await hub.lookup(input, { signal: controller.signal });
          res.setHeader('cache-control', 'public, max-age=3600');
          return send(res, 200, company);
        } catch (error) {
          if (controller.signal.aborted) return;
          return sendError(res, error);
        }
      }
    }

    return send(res, 404, { error: 'not_found', message: 'Rota não encontrada.' });
  });
}

function sendError(res: ServerResponse, error: unknown): void {
  const [status, body] = errorResponse(error);
  send(res, status, body);
}

function errorResponse(error: unknown): [number, object] {
  if (error instanceof InvalidCnpjError) {
    return [400, { error: 'invalid_cnpj', message: error.message }];
  }
  if (error instanceof CnpjNotFoundError) {
    return [404, { error: 'cnpj_not_found', message: error.message }];
  }
  if (error instanceof AllProvidersFailedError) {
    return [
      502,
      {
        error: 'providers_unavailable',
        message: 'Nenhum provedor respondeu. Tente novamente em instantes.',
        details: error.errors.map((e) => e.message),
      },
    ];
  }
  return [500, { error: 'internal_error', message: 'Erro inesperado.' }];
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
