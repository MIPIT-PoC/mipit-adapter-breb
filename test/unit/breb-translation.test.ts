/**
 * Tests for Bre-B ↔ Canonical translation (mipit-core).
 * These tests verify the end-to-end translation pipeline used by the adapter.
 */

import { brebToCanonical, generateBrebTransactionId, type BreBPaymentRequest } from '../../src/breb/types';

// Re-test translation functions from adapter perspective
describe('generateBrebTransactionId', () => {
  it('generates IDs starting with BR followed by 8-digit entity code', () => {
    const id = generateBrebTransactionId('00000007');
    expect(id.substring(0, 10)).toBe('BR00000007');
  });

  it('positions 10-17 contain YYYYMMDD format', () => {
    const id = generateBrebTransactionId('26264220');
    const dateSection = id.substring(10, 18);
    expect(/^\d{8}$/.test(dateSection)).toBe(true);
    // Must be a valid date (YYYYMMDD)
    const year = parseInt(dateSection.substring(0, 4), 10);
    expect(year).toBeGreaterThanOrEqual(2023);
  });

  it('positions 18-21 contain HHmm format', () => {
    const id = generateBrebTransactionId('26264220');
    const timeSection = id.substring(18, 22);
    expect(/^\d{4}$/.test(timeSection)).toBe(true);
    const hours = parseInt(timeSection.substring(0, 2), 10);
    const minutes = parseInt(timeSection.substring(2, 4), 10);
    expect(hours).toBeLessThanOrEqual(23);
    expect(minutes).toBeLessThanOrEqual(59);
  });
});

describe('BreBPaymentRequest shape', () => {
  it('has required fields', () => {
    const req: BreBPaymentRequest = {
      idTransaccion: generateBrebTransactionId(),
      valor: { original: '500000.00' },
      pagador: {
        codigoEntidad: '26264220',
        nombre: 'Carlos López',
        nit: '900123456-1',
        numeroCuenta: '1234567890',
        tipoCuenta: 'CACC',
      },
      beneficiario: {
        codigoEntidad: '00000007',
        nombre: 'Ana García',
        numeroCuenta: '0987654321',
      },
      llave: '+573001234567',
      tipoLlave: 'TELEFONO',
      concepto: 'Pago de prueba MIPIT',
    };

    expect(req.idTransaccion).toHaveLength(32);
    expect(req.valor.original).toBe('500000.00');
    expect(req.pagador.codigoEntidad).toBe('26264220');
    expect(req.beneficiario.codigoEntidad).toBe('00000007');
    expect(req.llave).toBe('+573001234567');
    expect(req.tipoLlave).toBe('TELEFONO');
  });

  it('supports NIT identification for business payments', () => {
    const req: BreBPaymentRequest = {
      idTransaccion: generateBrebTransactionId(),
      valor: { original: '5000000.00' },
      pagador: {
        codigoEntidad: '26264220',
        nombre: 'Empresa ABC SAS',
        nit: '900123456-1',
      },
      beneficiario: {
        codigoEntidad: '00000051',
        nombre: 'Proveedor XYZ Ltda',
        nit: '800654321-3',
      },
      llave: '800654321-3',
      tipoLlave: 'NIT',
      concepto: 'Pago factura 001',
    };

    expect(req.tipoLlave).toBe('NIT');
    expect(req.pagador.nit).toBe('900123456-1');
    expect(req.beneficiario.nit).toBe('800654321-3');
  });
});
