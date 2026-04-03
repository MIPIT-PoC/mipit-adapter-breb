/**
 * Bre-B BanRep SPI Mock Server
 *
 * Simulates the Banco de la República (Colombia) SPI sandbox endpoint for PoC testing.
 * Implements the Bre-B SPI response format per BanRep specification:
 *   POST /breb/v1/pagos → BreBPaymentResponse
 *
 * Simulated behaviors:
 *   - 5%  RECHAZADA: BREB001 (fondos insuficientes)
 *   - 3%  RECHAZADA: BREB004 (receptor no registrado)
 *   - 2%  RECHAZADA: BREB003 (límite excedido) when amount > 20,000,000 COP
 *   - idTransaccion format validation (32 chars, starts with 'BR')
 *   - Realistic latency simulation (80–400ms)
 *   - COP amount limits: max 20,000,000 COP per transaction
 */

import express from 'express';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { BreBPaymentRequest, BreBPaymentResponse } from './types.js';

const app = express();
app.use(express.json());

const MAX_AMOUNT_COP = 20_000_000; // BanRep per-transaction limit for natural persons

/**
 * POST /breb/v1/pagos
 * Simulates the BanRep Bre-B settlement endpoint.
 */
app.post('/breb/v1/pagos', (req, res) => {
  const body = req.body as Partial<BreBPaymentRequest>;
  const { idTransaccion, valor, pagador, beneficiario, llave } = body;

  // === Validation: idTransaccion ===
  if (!idTransaccion || !/^BR\d{8}\d{8}\d{4}[A-Z0-9]{10}$/.test(idTransaccion)) {
    logger.warn({ idTransaccion }, 'Bre-B mock: invalid idTransaccion format');
    return res.status(400).json({
      titulo: 'Parámetro inválido.',
      detalle: `El campo idTransaccion '${idTransaccion ?? ''}' no cumple el formato BR{codigoEntidad(8)}{YYYYMMDD}{HHmm}{unique(10)}.`,
      violaciones: [{ razon: 'Campo fuera del patrón esperado.', campo: 'idTransaccion' }],
    });
  }

  // === Validation: Amount ===
  if (!valor?.original || !/^\d+\.\d{2}$/.test(valor.original)) {
    return res.status(400).json({
      titulo: 'Parámetro inválido.',
      detalle: 'El campo valor.original debe ser string con exactamente 2 decimales.',
      violaciones: [{ razon: 'Formato inválido.', campo: 'valor.original' }],
    });
  }

  const amountCOP = parseFloat(valor.original);

  if (amountCOP <= 0) {
    return res.status(200).json(buildRejectedResponse(idTransaccion, 'BREB_AM01', 'Valor cero no permitido.'));
  }

  // === Validation: COP limit ===
  if (amountCOP > MAX_AMOUNT_COP) {
    return res.status(200).json(buildRejectedResponse(idTransaccion, 'BREB003', `Monto excede el límite por transacción de ${MAX_AMOUNT_COP.toLocaleString('es-CO')} COP.`));
  }

  // === Validation: Pagador ===
  if (!pagador?.codigoEntidad || !/^\d{8}$/.test(pagador.codigoEntidad)) {
    return res.status(400).json({
      titulo: 'Entidad pagadora inválida.',
      detalle: 'pagador.codigoEntidad debe ser 8 dígitos.',
      violaciones: [{ razon: 'Formato inválido.', campo: 'pagador.codigoEntidad' }],
    });
  }

  // === Validation: Llave ===
  if (!llave || llave.trim() === '') {
    return res.status(400).json({
      titulo: 'Llave requerida.',
      detalle: 'El campo llave (alias Bre-B del beneficiario) es obligatorio.',
      violaciones: [{ razon: 'Campo requerido.', campo: 'llave' }],
    });
  }

  // Simulate realistic latency
  const latency = 80 + Math.floor(Math.random() * 320);

  setTimeout(() => {
    const rand = Math.random();

    // 5% fondos insuficientes
    if (rand < 0.05) {
      logger.info({ idTransaccion }, 'Bre-B mock: simulating BREB001 (fondos insuficientes)');
      return res.status(200).json(
        buildRejectedResponse(idTransaccion, 'BREB001', 'Fondos insuficientes en la cuenta del pagador.')
      );
    }

    // 3% receptor no registrado
    if (rand < 0.08) {
      logger.info({ idTransaccion, llave }, 'Bre-B mock: simulating BREB004 (receptor no registrado)');
      return res.status(200).json(
        buildRejectedResponse(idTransaccion, 'BREB004', `La llave '${llave}' no está registrada en el sistema Bre-B.`)
      );
    }

    // 92% success (ACEPTADA)
    const idConfirmacion = `BRE${Date.now()}${ulid().substring(0, 6)}`;
    logger.info({ idTransaccion, idConfirmacion, amountCOP }, 'Bre-B mock: payment ACEPTADA');

    const response: BreBPaymentResponse = {
      idTransaccion,
      idConfirmacion,
      estado: 'ACEPTADA',
      fechaLiquidacion: new Date().toISOString(),
    };

    return res.status(200).json(response);
  }, latency);
});

/** GET /health — health check */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mipit-breb-mock', timestamp: new Date().toISOString() });
});

function buildRejectedResponse(idTransaccion: string, codigoError: string, descripcion: string): BreBPaymentResponse {
  return {
    idTransaccion,
    idConfirmacion: `ERR${Date.now()}`,
    estado: 'RECHAZADA',
    codigoError,
    descripcionError: descripcion,
  };
}

export function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(env.BREB_MOCK_PORT, () => {
      logger.info({ port: env.BREB_MOCK_PORT }, 'Bre-B BanRep mock server started');
      resolve();
    });
  });
}

export { app };
