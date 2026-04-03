import { brebResponseToAck } from '../../src/breb/response-mapper';
import type { BreBPaymentResponse } from '../../src/breb/types';

function makeResponse(overrides: Partial<BreBPaymentResponse> = {}): BreBPaymentResponse {
  return {
    idTransaccion: 'BR2626422020230601120012345ABC',
    idConfirmacion: 'BRE1234567890ABC',
    estado: 'ACEPTADA',
    fechaLiquidacion: '2023-06-01T12:00:05.000Z',
    ...overrides,
  };
}

describe('brebResponseToAck', () => {
  describe('ACEPTADA', () => {
    it('maps to ACCEPTED status', () => {
      const ack = brebResponseToAck(makeResponse());
      expect(ack.status).toBe('ACCEPTED');
    });

    it('sets rail_tx_id from idConfirmacion', () => {
      const ack = brebResponseToAck(makeResponse({ idConfirmacion: 'BRE_CONF_123' }));
      expect(ack.rail_tx_id).toBe('BRE_CONF_123');
    });

    it('includes raw_response', () => {
      const response = makeResponse();
      const ack = brebResponseToAck(response);
      expect(ack.raw_response).toBeDefined();
    });

    it('has no error field', () => {
      const ack = brebResponseToAck(makeResponse());
      expect(ack.error).toBeUndefined();
    });
  });

  describe('RECHAZADA', () => {
    it('maps to REJECTED status', () => {
      const ack = brebResponseToAck(makeResponse({
        estado: 'RECHAZADA',
        codigoError: 'BREB001',
        descripcionError: 'Fondos insuficientes en la cuenta del pagador.',
      }));
      expect(ack.status).toBe('REJECTED');
    });

    it('maps BanRep error code to error.code', () => {
      const ack = brebResponseToAck(makeResponse({
        estado: 'RECHAZADA',
        codigoError: 'BREB001',
        descripcionError: 'Fondos insuficientes.',
      }));
      expect(ack.error?.code).toBe('BREB001');
    });

    it('maps descripcionError to error.message', () => {
      const ack = brebResponseToAck(makeResponse({
        estado: 'RECHAZADA',
        codigoError: 'BREB004',
        descripcionError: "La llave '+573001234567' no está registrada en Bre-B.",
      }));
      expect(ack.error?.message).toContain('+573001234567');
    });

    it('falls back to generic message when descripcionError missing', () => {
      const ack = brebResponseToAck(makeResponse({ estado: 'RECHAZADA', codigoError: 'BREB002' }));
      expect(ack.error?.message).toBeTruthy();
      expect(ack.error?.code).toBe('BREB002');
    });

    it('falls back to BREB_RECHAZADA code when codigoError missing', () => {
      const ack = brebResponseToAck(makeResponse({ estado: 'RECHAZADA' }));
      expect(ack.error?.code).toBe('BREB_RECHAZADA');
    });
  });

  describe('DEVUELTA', () => {
    it('maps to REJECTED status with BREB_DEVUELTA code', () => {
      const ack = brebResponseToAck(makeResponse({ estado: 'DEVUELTA', descripcionError: 'Devuelto por el beneficiario.' }));
      expect(ack.status).toBe('REJECTED');
      expect(ack.error?.code).toBe('BREB_DEVUELTA');
    });

    it('uses descripcionError as message', () => {
      const ack = brebResponseToAck(makeResponse({ estado: 'DEVUELTA', descripcionError: 'Beneficiario rechazó el pago.' }));
      expect(ack.error?.message).toContain('Beneficiario');
    });
  });

  describe('EN_PROCESO', () => {
    it('maps to ERROR status with BREB_EN_PROCESO code', () => {
      const ack = brebResponseToAck(makeResponse({ estado: 'EN_PROCESO' }));
      expect(ack.status).toBe('ERROR');
      expect(ack.error?.code).toBe('BREB_EN_PROCESO');
    });

    it('message explains timeout', () => {
      const ack = brebResponseToAck(makeResponse({ estado: 'EN_PROCESO' }));
      expect(ack.error?.message).toContain('timeout');
    });
  });

  describe('rail_tx_id fallback', () => {
    it('uses idConfirmacion as rail_tx_id', () => {
      const ack = brebResponseToAck(makeResponse({ idConfirmacion: 'BRE_CONF_XYZ' }));
      expect(ack.rail_tx_id).toBe('BRE_CONF_XYZ');
    });

    it('falls back to idTransaccion when idConfirmacion is missing', () => {
      const response = makeResponse({ idConfirmacion: undefined as unknown as string });
      const ack = brebResponseToAck(response);
      expect(ack.rail_tx_id).toBe('BR2626422020230601120012345ABC');
    });
  });
});
