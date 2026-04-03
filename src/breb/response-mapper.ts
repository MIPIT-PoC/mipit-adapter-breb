import type { BreBPaymentResponse } from './types.js';

export interface RailAck {
  rail_tx_id?: string;
  status: 'ACCEPTED' | 'REJECTED' | 'ERROR';
  error?: { code: string; message: string };
  raw_response?: Record<string, unknown>;
}

/**
 * Maps a Bre-B SPI response to the MIPIT internal RailAck format.
 *
 * BanRep SPI statuses:
 *   ACEPTADA    → ACCEPTED
 *   RECHAZADA   → REJECTED (with BanRep error code)
 *   DEVUELTA    → REJECTED (returned/refunded)
 *   EN_PROCESO  → ERROR (timeout / still processing)
 *
 * Error codes (BanRep spec):
 *   BREB001 — Fondos insuficientes
 *   BREB002 — Cuenta/entidad no encontrada
 *   BREB003 — Límite de transacción excedido
 *   BREB004 — Receptor no registrado en Bre-B
 *   BREB005 — Timeout del sistema BanRep
 */
export function brebResponseToAck(response: BreBPaymentResponse): RailAck {
  const railTxId = response.idConfirmacion ?? response.idTransaccion;

  switch (response.estado) {
    case 'ACEPTADA':
      return {
        rail_tx_id: railTxId,
        status: 'ACCEPTED',
        raw_response: response as unknown as Record<string, unknown>,
      };

    case 'RECHAZADA':
      return {
        rail_tx_id: railTxId,
        status: 'REJECTED',
        error: {
          code: response.codigoError ?? 'BREB_RECHAZADA',
          message: response.descripcionError ?? 'Transacción rechazada por BanRep SPI',
        },
        raw_response: response as unknown as Record<string, unknown>,
      };

    case 'DEVUELTA':
      return {
        rail_tx_id: railTxId,
        status: 'REJECTED',
        error: {
          code: 'BREB_DEVUELTA',
          message: response.descripcionError ?? 'Transacción devuelta por el beneficiario',
        },
        raw_response: response as unknown as Record<string, unknown>,
      };

    case 'EN_PROCESO':
      return {
        rail_tx_id: railTxId,
        status: 'ERROR',
        error: {
          code: 'BREB_EN_PROCESO',
          message: 'Transacción aún en proceso en BanRep SPI — timeout alcanzado por el adapter',
        },
        raw_response: response as unknown as Record<string, unknown>,
      };

    default:
      return {
        rail_tx_id: railTxId,
        status: 'ERROR',
        error: {
          code: 'BREB_UNKNOWN_STATUS',
          message: `Estado BanRep desconocido: ${(response as BreBPaymentResponse).estado}`,
        },
        raw_response: response as unknown as Record<string, unknown>,
      };
  }
}
