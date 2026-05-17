/**
 * Bre-B (Banco de la República — Colombia) Payment Protocol Types
 *
 * CRITICAL NOTE (P04 — PoC limitation):
 * As of audit date (2026-05-16), Banco de la República has NOT published a
 * public wire-format specification for Bre-B SPI participant integration.
 * Field names (`idTransaccion`, `pagador`, `beneficiario`, `llave`,
 * `tipoLlave`, `concepto`), error codes (BREB001-BREB005), OAuth flow with
 * scope `breb.pagos`, and idTransaccion format below are educated guesses
 * NOT verified against BanRep documentation.
 *
 * Llave types and entity codes ARE based on public BanRep announcements:
 *   - https://www.banrep.gov.co/es/bre-b
 *   - https://www.banrep.gov.co/es/bre-b/que-es
 *
 * idTransaccion format (invented): BR + codigoEntidad(4) + YYYYMMDD(8, COT) +
 *                                  HHmm(4) + unique(10 alnum) = 28 chars
 * Currency: COP (no decimals — BanRep emits as integer)
 * Settlement: real-time (< 10s) 24/7/365
 */

import { randomBytes } from 'node:crypto';

/**
 * P04 — Full BanRep llave catalog.
 * - CC:   Cédula de Ciudadanía (6-10 digits)
 * - CE:   Cédula de Extranjería (6-7 digits)
 * - NIT:  Number with check digit (e.g. "900123456-1")
 * - PASAPORTE: passport (alphanumeric)
 * - TELEFONO: mobile only (+57 3xx xxxxxxx)
 * - EMAIL: RFC 5321
 * - ALIAS: @-prefixed alphanumeric (e.g. @juan.perez)
 */
export type BreBKeyType =
  | 'CC'
  | 'CE'
  | 'NIT'
  | 'PASAPORTE'
  | 'TELEFONO'
  | 'EMAIL'
  | 'ALIAS';

export type BreBAccountType = 'CACC' | 'SVGS' | 'TRAN';
export type BreBStatus = 'ACEPTADA' | 'RECHAZADA' | 'EN_PROCESO' | 'DEVUELTA';

/**
 * Bre-B payment request.
 * Sent to: POST /breb/v1/pagos (INVENTED endpoint — see header).
 */
export interface BreBPaymentRequest {
  idTransaccion: string;

  valor: {
    /** P04 — Amount as string. COP integer (no centavos) or up to 2-decimal. */
    original: string;
  };

  pagador: {
    /** Superfinanciera 4-digit entity code (e.g. "0007" Bancolombia, "0051" Davivienda) */
    codigoEntidad: string;
    nombre: string;
    /** NIT with check digit (DIAN mod-11) */
    nit?: string;
    /** Cédula de Ciudadanía */
    cc?: string;
    numeroCuenta?: string;
    tipoCuenta?: BreBAccountType;
  };

  beneficiario: {
    codigoEntidad: string;
    nombre: string;
    nit?: string;
    cc?: string;
    numeroCuenta?: string;
    tipoCuenta?: BreBAccountType;
  };

  /** Bre-B llave (alias) of the beneficiary — see BreBKeyType for formats */
  llave: string;
  tipoLlave?: BreBKeyType;

  /** Concept/description (max 140 chars) */
  concepto?: string;

  /** ISO 8601 timestamp */
  fechaHora?: string;
}

/** Response (shape invented for PoC). */
export interface BreBPaymentResponse {
  idTransaccion: string;
  idConfirmacion: string;
  estado: BreBStatus;
  fechaLiquidacion?: string;
  codigoError?: string;
  descripcionError?: string;
}

/**
 * P04 — Superfinanciera 4-digit codes (the Colombian financial sector standard).
 * Previous "8-digit zero-padded" codes (BREB_ENTITY_CODES) were invented.
 * Source: Superintendencia Financiera de Colombia catálogo de entidades.
 */
export const SUPERFIN_ENTITY_CODES = {
  BANCO_DE_BOGOTA:  '0001',
  CITIBANK:         '0009',
  BANCO_AGRARIO:    '0040',
  BANCO_OCCIDENTE:  '0023',
  BANCOLOMBIA:      '0007',
  BBVA_COLOMBIA:    '0013',
  DAVIVIENDA:       '0051',
  AV_VILLAS:        '0052',
  POPULAR:          '0002',
  COLPATRIA:        '0019', // Scotiabank Colpatria
  ITAU:             '0006',
  FALABELLA:        '0058',
  NEQUI:            '0507', // SEDPE de Bancolombia
  DAVIPLATA:        '0551', // SEDPE de Davivienda
  // PoC simulated PSP (9xxx range reserved for non-bank / simulation in this PoC)
  MIPIT_FINTECH_SIM: '9999',
} as const;

/**
 * @deprecated Use SUPERFIN_ENTITY_CODES (4-digit). Kept for backward
 * compatibility during P04 rollout; values left-padded from 4-digit to 8.
 */
export const BREB_ENTITY_CODES = {
  BANCOLOMBIA:       '00000007',
  BANCO_DE_BOGOTA:   '00000001',
  DAVIVIENDA:        '00000051',
  NEQUI:             '00000507',
  DAVIPLATA:         '00000551',
  FINTECH_SIMULATED: '00009999',
} as const;

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * P04 — Generate a Bre-B idTransaccion. Format INVENTED for this PoC because
 * BanRep has not published the wire-level spec.
 *
 *   BR + entidad(4) + YYYYMMDD(8, Bogotá UTC-5) + HHmm(4) + suffix(10 alnum)
 *   = 28 chars
 *
 * Uses crypto.randomBytes for the suffix (was Math.random).
 */
export function generateBrebTransactionId(
  codigoEntidad: string = SUPERFIN_ENTITY_CODES.MIPIT_FINTECH_SIM,
  now: Date = new Date(),
): string {
  // P04: accept either 4-digit Superfinanciera (preferred) or legacy 8-digit
  // (for backward compatibility during rollout). Reject anything else.
  if (!/^\d{4}$/.test(codigoEntidad) && !/^\d{8}$/.test(codigoEntidad)) {
    throw new Error(`Bre-B entity code must be 4 or 8 digits, got: ${codigoEntidad}`);
  }
  const cot = new Date(now.getTime() - 5 * 3600 * 1000);
  const yyyy = cot.getUTCFullYear();
  const mm = String(cot.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(cot.getUTCDate()).padStart(2, '0');
  const hh = String(cot.getUTCHours()).padStart(2, '0');
  const mi = String(cot.getUTCMinutes()).padStart(2, '0');
  const date = `${yyyy}${mm}${dd}`;
  const time = `${hh}${mi}`;
  const bytes = randomBytes(10);
  let suffix = '';
  for (let i = 0; i < 10; i++) suffix += ALNUM[bytes[i] % ALNUM.length];
  return `BR${codigoEntidad}${date}${time}${suffix}`;
}

/**
 * P04 — NIT mod-11 check-digit validation per DIAN.
 * Weights right-to-left: [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71].
 * Format: "<9 or 10 digits>-<check>"
 */
export function isValidNIT(nitWithCheck: string): boolean {
  const m = nitWithCheck.match(/^(\d{9,10})-(\d)$/);
  if (!m) return false;
  const digits = m[1].split('').reverse();
  const check = parseInt(m[2], 10);
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += parseInt(digits[i], 10) * weights[i];
  const rem = sum % 11;
  const expected = rem < 2 ? rem : 11 - rem;
  return expected === check;
}
