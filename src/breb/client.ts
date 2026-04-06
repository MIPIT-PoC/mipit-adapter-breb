import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { BreBPaymentRequest, BreBPaymentResponse } from './types.js';

const MAX_RETRIES = env.BREB_MAX_RETRIES;
const TIMEOUT_MS = env.BREB_TIMEOUT_MS;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(`${env.BREB_SANDBOX_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'mipit-core',
      client_secret: 'mipit-secret-breb-2024',
      scope: 'breb.pagos',
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token request failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  logger.info('Bre-B OAuth2 token acquired');
  return cachedToken.token;
}

/**
 * Sends a Bre-B payment request to the BanRep SPI endpoint (or mock).
 * Retries up to BREB_MAX_RETRIES times on transient failures (5xx, network errors).
 */
export async function sendBrebPayment(request: BreBPaymentRequest): Promise<BreBPaymentResponse> {
  const url = `${env.BREB_SANDBOX_URL}/breb/v1/pagos`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      logger.info(
        { idTransaccion: request.idTransaccion, attempt, url },
        'Sending Bre-B payment request',
      );

      const token = await getOAuthToken();
      let res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Adapter': 'mipit-adapter-breb',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (res.status === 401) {
        cachedToken = null;
        const newToken = await getOAuthToken();
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`,
            'X-Adapter': 'mipit-adapter-breb',
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      }

      clearTimeout(timeoutId);

      const body = await res.json() as BreBPaymentResponse;

      if (!res.ok && res.status < 500) {
        // 4xx: client error — do not retry
        logger.warn({ status: res.status, body }, 'Bre-B SPI returned client error');
        return body;
      }

      if (!res.ok) {
        throw new Error(`Bre-B SPI server error: HTTP ${res.status}`);
      }

      logger.info(
        { idTransaccion: request.idTransaccion, estado: body.estado },
        'Bre-B SPI response received',
      );
      return body;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        { attempt, maxRetries: MAX_RETRIES, err: lastError.message },
        'Bre-B payment attempt failed, retrying...',
      );

      if (attempt < MAX_RETRIES) {
        await sleep(200 * attempt); // exponential backoff: 200ms, 400ms, ...
      }
    }
  }

  throw lastError ?? new Error('Bre-B payment failed after all retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
