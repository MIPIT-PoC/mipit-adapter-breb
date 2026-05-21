/**
 * Bre-B BanRep SPI Mock Server
 *
 * CRITICAL NOTE (P04 — PoC limitation):
 * As of audit date (2026-05-16), Banco de la República has NOT published a
 * public wire-format specification for Bre-B SPI participant integration.
 * The endpoint URL (`POST /breb/v1/pagos`), field names, error codes
 * (BREB001-BREB005), and OAuth flow are EDUCATED GUESSES, not BanRep-verified.
 *
 * Llave types ARE based on public BanRep announcements (see types.ts).
 *
 * Implementation details (post P04):
 *   - Full BanRep llave taxonomy: CC, CE, NIT, PASAPORTE, TELEFONO (mobile
 *     only: +57 3xx), EMAIL, ALIAS (@-prefix per BanRep).
 *   - NIT mod-11 DIAN check-digit validation (not just regex form).
 *   - idTransaccion in Bogotá time (UTC-5), not UTC (was wrong before).
 *   - codigoEntidad accepts 4-digit Superfinanciera (preferred) or legacy
 *     8-digit during rollout.
 *   - Operating hours: 24/7/365 per BanRep launch announcements.
 *   - Idempotency by idTransaccion.
 *   - Invented error codes BREB001-005 (NOT a real BanRep catalog).
 *
 * For thesis-defense honesty: this adapter is a "reference implementation
 * pending official spec publication", not byte-fidelity to a real Bre-B API.
 */

import express from 'express';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { BreBPaymentRequest, BreBPaymentResponse } from './types.js';
import { isValidNIT } from './types.js';
import { registerOAuth2Routes, oauthMiddleware } from './oauth-mock.js';
import { registerAdminRoutes, mockConfig, mockStats } from './admin-routes.js';

const app = express();
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '3600');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

registerOAuth2Routes(app);
app.use(oauthMiddleware);

/** In-memory idempotency store: idTransaccion → response */
const processedPayments = new Map<string, BreBPaymentResponse>();

registerAdminRoutes(app, processedPayments);

/** Bre-B per-transaction limits (COP) */
const LIMIT_NATURAL_COP    = 20_000_000;   // natural persons
const LIMIT_JURIDICA_COP   = 200_000_000;  // legal entities (NIT payer)

/**
 * P04 — Full BanRep llave taxonomy:
 *   CC, CE, NIT, PASAPORTE, TELEFONO (mobile only), EMAIL, ALIAS (@-prefix).
 * Previous validator set rejected CC/CE/Pasaporte; ALIAS rejected the `@`
 * prefix that BanRep requires.
 */
const LLAVE_VALIDATORS: Record<string, RegExp> = {
  CC:        /^\d{6,10}$/,                              // 6–10 digits
  CE:        /^\d{6,7}$/,                               // Cédula extranjería 6–7 digits
  NIT:       /^\d{9,10}-\d$/,                           // 9–10 + dash + check
  PASAPORTE: /^[A-Z0-9]{6,12}$/i,                       // alphanumeric
  TELEFONO:  /^\+573\d{9}$/,                            // mobile only: +57 3xx XXX XXXX
  EMAIL:     /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  ALIAS:     /^@[A-Za-z0-9._]{3,19}$/,                  // BanRep: @-prefix + 3–19 chars
};

/**
 * POST /breb/v1/pagos
 * Simulates the BanRep Bre-B settlement endpoint.
 */
app.post('/breb/v1/pagos', (req, res) => {
  const body = req.body as Partial<BreBPaymentRequest>;
  const { idTransaccion, valor, pagador, beneficiario, llave, tipoLlave, concepto } = body;

  // === Idempotency: return cached response for duplicate idTransaccion ===
  if (idTransaccion && processedPayments.has(idTransaccion)) {
    logger.info({ idTransaccion }, 'Bre-B mock: duplicate idTransaccion — returning cached response');
    return res.status(200).json(processedPayments.get(idTransaccion));
  }

  // === Validation: idTransaccion format ===
  // Format: BR + codigoEntidad(8) + YYYYMMDD(8) + HHmm(4) + unique(10) = 32 chars
  // P04 — accept 4-digit (preferred, 28 chars total) and legacy 8-digit
  // entity code (32 chars total) during rollout.
  if (!idTransaccion || !/^BR(\d{4}|\d{8})\d{8}\d{4}[A-Za-z0-9]{10}$/.test(idTransaccion)) {
    logger.warn({ idTransaccion }, 'Bre-B mock: invalid idTransaccion format');
    return res.status(400).json({
      titulo: 'Parámetro inválido.',
      detalle: `idTransaccion '${idTransaccion ?? ''}' no cumple el formato BR{codigoEntidad(8)}{YYYYMMDD}{HHmm}{unique(10)} = 32 chars.`,
      violaciones: [{ razon: 'Campo fuera del patrón esperado.', campo: 'idTransaccion' }],
    });
  }

  // === Validation: Amount format ===
  // Audit 4 B1-007 — BanRep TR-002 §5 declara COP integer (sin decimales), pero
  // el mock original requería ".XX" forzando inconsistencia con `mapper.ts`
  // que ya emite COP integer. Aceptamos ambos: "500000" e "500000.00".
  if (!valor?.original || !/^\d+(\.\d{2})?$/.test(valor.original)) {
    return res.status(400).json({
      titulo: 'Parámetro inválido.',
      detalle: 'valor.original debe ser string numérico — COP integer (ej: "500000") o con 2 decimales para monedas non-COP (ej: "500000.00").',
      violaciones: [{ razon: 'Formato inválido.', campo: 'valor.original' }],
    });
  }

  const amountCOP = parseFloat(valor.original);

  if (amountCOP <= 0) {
    const r = buildRejectedResponse(idTransaccion, 'BREB_AM01', 'Valor cero no está permitido en el sistema Bre-B.');
    processedPayments.set(idTransaccion, r);
    return res.status(200).json(r);
  }

  // === Validation: pagador entity code ===
  if (!pagador?.codigoEntidad || !/^(\d{4}|\d{8})$/.test(pagador.codigoEntidad)) {
    return res.status(400).json({
      titulo: 'Entidad pagadora inválida.',
      // W6.7 — accept 4-digit Superfinanciera (preferred per TR-002) or legacy 8-digit.
      detalle: 'pagador.codigoEntidad debe ser 4 dígitos (catálogo Superfinanciera) u 8 dígitos (formato legacy).',
      violaciones: [{ razon: 'Formato inválido.', campo: 'pagador.codigoEntidad' }],
    });
  }

  // === Validation: pagador nombre required ===
  if (!pagador?.nombre || pagador.nombre.trim() === '') {
    return res.status(400).json({
      titulo: 'Nombre del pagador requerido.',
      detalle: 'pagador.nombre es obligatorio.',
      violaciones: [{ razon: 'Campo requerido.', campo: 'pagador.nombre' }],
    });
  }

  // === Validation: beneficiario entity code ===
  if (beneficiario?.codigoEntidad && !/^(\d{4}|\d{8})$/.test(beneficiario.codigoEntidad)) {
    return res.status(400).json({
      titulo: 'Entidad beneficiaria inválida.',
      detalle: 'beneficiario.codigoEntidad debe ser 4 dígitos (catálogo Superfinanciera) u 8 dígitos (formato legacy).',
      violaciones: [{ razon: 'Formato inválido.', campo: 'beneficiario.codigoEntidad' }],
    });
  }

  // === Validation: llave required ===
  if (!llave || llave.trim() === '') {
    return res.status(400).json({
      titulo: 'Llave requerida.',
      detalle: 'El campo llave (alias Bre-B del beneficiario) es obligatorio.',
      violaciones: [{ razon: 'Campo requerido.', campo: 'llave' }],
    });
  }

  // === Validation: llave format by tipoLlave ===
  if (tipoLlave && LLAVE_VALIDATORS[tipoLlave]) {
    if (!LLAVE_VALIDATORS[tipoLlave].test(llave)) {
      const r = buildRejectedResponse(idTransaccion, 'BREB002',
        `La llave '${llave}' no cumple el formato esperado para tipoLlave '${tipoLlave}'. ` +
        `Formatos aceptados — CC: 6–10 dígitos | CE: 6–7 dígitos | NIT: XXXXXXXXX-D | ` +
        `PASAPORTE: 6–12 alfanuméricos | TELEFONO: +573XXXXXXXXX (móvil) | EMAIL: user@domain.co | ALIAS: @alfanum.`);
      processedPayments.set(idTransaccion, r);
      return res.status(200).json(r);
    }
    // P04 — NIT mod-11 DIAN check digit validation (not just regex form)
    if (tipoLlave === 'NIT' && !isValidNIT(llave)) {
      const r = buildRejectedResponse(idTransaccion, 'BREB002',
        `NIT '${llave}' falló validación de dígito verificador (DIAN mod-11).`);
      processedPayments.set(idTransaccion, r);
      return res.status(200).json(r);
    }
  }

  // === Validation: concepto max 140 chars ===
  if (concepto && concepto.length > 140) {
    return res.status(400).json({
      titulo: 'Concepto demasiado largo.',
      detalle: 'concepto no puede exceder 140 caracteres.',
      violaciones: [{ razon: 'Longitud excedida.', campo: 'concepto' }],
    });
  }

  // === Validation: COP transaction limit ===
  // Legal entities (NIT) have a higher limit
  const isLegalEntity = Boolean(pagador?.nit);
  const applicableLimit = isLegalEntity ? LIMIT_JURIDICA_COP : LIMIT_NATURAL_COP;

  if (amountCOP > applicableLimit) {
    const r = buildRejectedResponse(idTransaccion, 'BREB003',
      `Monto COP ${amountCOP.toLocaleString('es-CO')} excede el límite por transacción de ` +
      `${applicableLimit.toLocaleString('es-CO')} COP para ${isLegalEntity ? 'personas jurídicas' : 'personas naturales'}.`);
    processedPayments.set(idTransaccion, r);
    return res.status(200).json(r);
  }

  mockStats.totalReceived++;
  mockStats.lastPaymentAt = new Date().toISOString();

  if (!mockConfig.enabled) {
    return res.status(503).json({
      titulo: 'Servicio no disponible.',
      detalle: 'El servicio Bre-B está temporalmente no disponible para mantenimiento.',
    });
  }

  if (mockConfig.forceRejectNext) {
    mockConfig.forceRejectNext = false;
    mockStats.totalRejected++;
    const r = buildRejectedResponse(idTransaccion, mockConfig.forceRejectCode,
      `[ADMIN] Rechazo forzado por el simulador (código: ${mockConfig.forceRejectCode}).`);
    processedPayments.set(idTransaccion, r);
    return res.status(200).json(r);
  }

  if (mockConfig.forceTimeoutNext) {
    mockConfig.forceTimeoutNext = false;
    mockStats.totalTimeout++;
    logger.info({ idTransaccion }, 'Bre-B mock: forcing 30s timeout (admin)');
    setTimeout(() => {
      res.status(504).json({
        titulo: 'Gateway Timeout',
        detalle: 'Bre-B no respondió dentro del plazo.',
      });
    }, 30_000);
    return;
  }

  const latencySpan = Math.max(0, mockConfig.maxLatencyMs - mockConfig.minLatencyMs);
  const latency = mockConfig.minLatencyMs + Math.floor(Math.random() * (latencySpan + 1));

  setTimeout(() => {
    const rand = Math.random();
    const rr = mockConfig.rejectionRate;

    // Within rejection bucket: 40% BREB001, 30% BREB004, 20% BREB002, 10% BREB005 (same relative mix as baseline ~10% total)
    if (rand < rr * 0.4) {
      logger.info({ idTransaccion, amountCOP }, 'Bre-B mock: BREB001 (fondos insuficientes)');
      mockStats.totalRejected++;
      const r = buildRejectedResponse(idTransaccion, 'BREB001',
        'Fondos insuficientes en la cuenta del pagador para cubrir el monto solicitado.');
      processedPayments.set(idTransaccion, r);
      return res.status(200).json(r);
    }

    if (rand < rr * 0.7) {
      logger.info({ idTransaccion, llave }, 'Bre-B mock: BREB004 (receptor no registrado)');
      mockStats.totalRejected++;
      const r = buildRejectedResponse(idTransaccion, 'BREB004',
        `La llave '${llave}' no está registrada en el Directorio Bre-B de BanRep.`);
      processedPayments.set(idTransaccion, r);
      return res.status(200).json(r);
    }

    if (rand < rr * 0.9) {
      logger.info({ idTransaccion }, 'Bre-B mock: BREB002 (datos del beneficiario incorrectos)');
      mockStats.totalRejected++;
      const r = buildRejectedResponse(idTransaccion, 'BREB002',
        'Los datos del beneficiario (nombre/entidad) no coinciden con los registrados en el Directorio Bre-B.');
      processedPayments.set(idTransaccion, r);
      return res.status(200).json(r);
    }

    if (rand < rr) {
      logger.info({ idTransaccion }, 'Bre-B mock: BREB005 (servicio temporalmente no disponible)');
      mockStats.totalRejected++;
      const r = buildRejectedResponse(idTransaccion, 'BREB005',
        'El servicio Bre-B está temporalmente no disponible. Reintente en unos minutos.');
      processedPayments.set(idTransaccion, r);
      return res.status(200).json(r);
    }

    const idConfirmacion = `BRE${Date.now()}${ulid().substring(0, 6)}`;
    logger.info({ idTransaccion, idConfirmacion, amountCOP }, 'Bre-B mock: payment ACEPTADA');
    mockStats.totalAccepted++;

    const response: BreBPaymentResponse = {
      idTransaccion,
      idConfirmacion,
      estado: 'ACEPTADA',
      fechaLiquidacion: new Date().toISOString(),
    };

    processedPayments.set(idTransaccion, response);
    return res.status(200).json(response);
  }, latency);
});

/** GET /breb/v1/pagos/:idTransaccion — query payment status */
app.get('/breb/v1/pagos/:idTransaccion', (req, res) => {
  const { idTransaccion } = req.params;
  const payment = processedPayments.get(idTransaccion);
  if (!payment) {
    return res.status(404).json({
      titulo: 'Pago no encontrado.',
      detalle: `idTransaccion '${idTransaccion}' no localizado en el sistema Bre-B.`,
    });
  }
  res.status(200).json(payment);
});

/** GET /health — health check */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'mipit-breb-mock',
    version: '1.0',
    processedCount: processedPayments.size,
    limits: {
      naturalPersonCOP: LIMIT_NATURAL_COP,
      legalEntityCOP: LIMIT_JURIDICA_COP,
    },
    timestamp: new Date().toISOString(),
  });
});

function buildRejectedResponse(
  idTransaccion: string,
  codigoError: string,
  descripcion: string,
): BreBPaymentResponse {
  return {
    idTransaccion,
    idConfirmacion: `ERR${Date.now()}`,
    estado: 'RECHAZADA',
    codigoError,
    descripcionError: descripcion,
  };
}

/** Frontend API Simulator endpoint */
app.post('/api/simulate/breb', (req, res) => {
  try {
    const { debtorAlias, creditorAlias, amount, currency, purpose, reference } = req.body;

    // Validation
    if (!debtorAlias || !creditorAlias || !amount || !currency) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['debtorAlias', 'creditorAlias', 'amount', 'currency'],
      });
    }

    // Simulate occasional failures (10%)
    const shouldFail = Math.random() < 0.1;
    const paymentId = `BRE${Date.now()}${Math.random().toString(36).substring(7)}`;
    const timestamp = new Date().toISOString();

    const responsePayload = {
      payment_id: paymentId,
      status: shouldFail ? 'failed' : 'completed',
      rail: 'BRE_B',
      timestamp,
      details: {
        debtor: debtorAlias,
        creditor: creditorAlias,
        amount: Number(amount),
        currency,
        purpose: purpose ?? 'TRANSFERENCIA',
        reference: reference ?? 'AUTO',
        processor_latency_ms: Math.round(150 + Math.random() * 450),
        error: shouldFail ? {
          code: 'IC-001',
          message: 'Fondos insuficientes en la cuenta de origen',
        } : null,
      },
    };

    res.status(200).json(responsePayload);
  } catch (err) {
    logger.error(err, 'Error in /api/simulate/breb');
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(env.BREB_MOCK_PORT, () => {
      logger.info({ port: env.BREB_MOCK_PORT }, 'Bre-B BanRep SPI mock server started (v1.0)');
      resolve();
    });
  });
}

export { app };
