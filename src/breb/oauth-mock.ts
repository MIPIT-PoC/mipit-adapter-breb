/**
 * OAuth2 Client Credentials Mock — Bre-B (BanRep / Banco de la República, Colombia)
 *
 * Simulates the OAuth2 authentication pattern used with SPI-style rails in Colombia.
 * The Banco de la República (BanRep) oversees the Colombian payment system infrastructure;
 * Bre-B (Billetera Electrónica Regional) interoperability aligns with SPI and regulatory
 * expectations for secure machine-to-machine access in PoC environments.
 *
 * This mock uses standard `client_credentials` for the PoC (no real mTLS/PKI),
 * mirroring how integrators obtain bearer tokens against sandbox gateways.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { logger } from '../observability/logger.js';

interface TokenEntry {
  token: string;
  clientId: string;
  expiresAt: number;
  scope: string;
}

const VALID_CLIENTS: Record<string, string> = {
  'mipit-core': 'mipit-secret-breb-2024',
  'mipit-test': 'test-secret-breb',
};

const TOKEN_TTL_MS = 3600_000; // 1 hour

const activeTokens = new Map<string, TokenEntry>();

export function registerOAuth2Routes(app: Express): void {
  app.post('/oauth/token', (req: Request, res: Response) => {
    const { grant_type, client_id, client_secret, scope } = req.body;

    if (grant_type !== 'client_credentials') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only client_credentials grant is supported for Bre-B sandbox OAuth2.',
      });
    }

    if (!client_id || !client_secret) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and client_secret are required.',
      });
    }

    if (VALID_CLIENTS[client_id] !== client_secret) {
      logger.warn({ client_id }, 'Bre-B OAuth2: invalid credentials');
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Client authentication failed.',
      });
    }

    const token = `breb_${crypto.randomBytes(32).toString('hex')}`;
    const entry: TokenEntry = {
      token,
      clientId: client_id,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      scope: scope ?? 'breb.pagos',
    };
    activeTokens.set(token, entry);

    logger.info({ client_id, scope: entry.scope }, 'Bre-B OAuth2: token issued');

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_MS / 1000,
      scope: entry.scope,
    });
  });
}

export function oauthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health' || req.path.startsWith('/oauth') || req.path.startsWith('/admin')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'invalid_token',
      error_description: 'Bearer token required. Obtain one via POST /oauth/token.',
    });
    return;
  }

  const token = authHeader.slice(7);
  const entry = activeTokens.get(token);

  if (!entry) {
    res.status(401).json({ error: 'invalid_token', error_description: 'Token not recognized.' });
    return;
  }

  if (Date.now() > entry.expiresAt) {
    activeTokens.delete(token);
    res.status(401).json({ error: 'invalid_token', error_description: 'Token expired.' });
    return;
  }

  next();
}
