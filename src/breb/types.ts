/**
 * Bre-B (Banco de la República — Colombia) Payment Protocol Types
 * Based on: BanRep Sistema de Pagos Inmediatos (SPI) specification v1.0 (2023)
 *
 * idTransaccion format: BR + codigoEntidad(8) + YYYYMMDD(8) + HHmm(4) + unique(10) = 32 chars
 * Example: BR2626422020230601120012345ABCDE
 *
 * Currency: always COP (Colombian Peso)
 * Settlement: real-time (< 10 seconds)
 */

export type BreBKeyType = 'TELEFONO' | 'NIT' | 'EMAIL' | 'ALIAS';
export type BreBAccountType = 'CACC' | 'SVGS' | 'TRAN';
export type BreBStatus = 'ACEPTADA' | 'RECHAZADA' | 'EN_PROCESO' | 'DEVUELTA';

/**
 * Bre-B payment request.
 * Sent to: POST /breb/v1/pagos
 */
export interface BreBPaymentRequest {
  idTransaccion: string;

  valor: {
    /** Amount string with exactly 2 decimal places, e.g. "500000.00" (COP) */
    original: string;
  };

  pagador: {
    /** BanRep entity code (8 digits, zero-padded) */
    codigoEntidad: string;
    nombre: string;
    /** NIT (Número de Identificación Tributaria) e.g. "900123456-1" */
    nit?: string;
    /** Cédula de Ciudadanía (personal ID) */
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

  /** Bre-B alias of the beneficiary */
  llave: string;
  tipoLlave?: BreBKeyType;

  /** Concept/description (max 140 chars) */
  concepto?: string;

  /** ISO 8601 timestamp */
  fechaHora?: string;
}

/**
 * Bre-B payment response from BanRep SPI.
 */
export interface BreBPaymentResponse {
  idTransaccion: string;
  /** BanRep internal confirmation ID */
  idConfirmacion: string;
  estado: BreBStatus;
  fechaLiquidacion?: string;
  /** Error code from BanRep spec */
  codigoError?: string;
  descripcionError?: string;
}

/** BanRep entity codes for major Colombian FIs */
export const BREB_ENTITY_CODES = {
  BANCOLOMBIA:       '00000007',
  BANCO_DE_BOGOTA:   '00000013',
  DAVIVIENDA:        '00000051',
  NEQUI:             '10007550',
  DAVIPLATA:         '00005141',
  FINTECH_SIMULATED: '26264220',
} as const;

/**
 * Generates a valid Bre-B idTransaccion.
 * Format: BR + codigoEntidad(8) + YYYYMMDD(8) + HHmm(4) + unique(10) = 32 chars
 */
export function generateBrebTransactionId(
  codigoEntidad: string = BREB_ENTITY_CODES.FINTECH_SIMULATED,
): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 16).replace(':', '');
  const unique = Math.random().toString(36).substring(2, 12).toUpperCase().padEnd(10, '0');
  return `BR${codigoEntidad}${date}${time}${unique}`;
}
