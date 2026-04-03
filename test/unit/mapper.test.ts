import { canonicalToBreBPayload } from '../../src/breb/mapper';
import { generateBrebTransactionId, BREB_ENTITY_CODES } from '../../src/breb/types';

// Minimal canonical pacs.008 fixture (sufficient for mapper)
function makeCanonical(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: 'PMT-01J8ABCDEF0001',
    created_at: '2023-06-01T12:00:00.000Z',
    amount: { value: 500000, currency: 'COP' },
    debtor: {
      account_id: '26264220/900123456-1',
      name: 'Carlos López',
      taxId: '900123456-1',
      accountType: 'CACC',
    },
    creditor: {
      account_id: '00000007/00098765',
      name: 'Ana García',
      taxId: '800987654-3',
      accountType: 'CACC',
    },
    alias: { type: 'LLAVE_BREB', value: '+573001234567' },
    purpose: 'P2P',
    reference: 'PMT-01J8ABCDEF0001',
    remittanceInfo: 'Pago servicio',
    origin: { rail: 'PIX', ispb: '26264220' },
    destination: { rail: 'BRE_B', ispb: '00000007' },
    ...overrides,
  };
}

describe('canonicalToBreBPayload', () => {
  it('generates a valid idTransaccion (32 chars, starts with BR)', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.idTransaccion).toMatch(/^BR\d{8}\d{8}\d{4}[A-Z0-9]{10}$/);
    expect(result.idTransaccion).toHaveLength(32);
  });

  it('maps amount correctly (no FX rate)', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.valor.original).toBe('500000.00');
  });

  it('applies FX rate when provided', () => {
    const canonical = makeCanonical({ fx: { source_currency: 'USD', rate: 4100 } });
    const result = canonicalToBreBPayload(canonical);
    // 500000 USD * 4100 = 2,050,000,000 COP
    expect(result.valor.original).toBe('2050000000.00');
  });

  it('maps pagador entity from origin.ispb', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.pagador.codigoEntidad).toBe('26264220');
  });

  it('maps beneficiario entity from destination.ispb', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.beneficiario.codigoEntidad).toBe('00000007');
  });

  it('falls back to FINTECH_SIMULATED when ispb not set', () => {
    const canonical = makeCanonical({ origin: { rail: 'PIX' }, destination: { rail: 'BRE_B' } });
    const result = canonicalToBreBPayload(canonical);
    expect(result.pagador.codigoEntidad).toBe(BREB_ENTITY_CODES.FINTECH_SIMULATED);
    expect(result.beneficiario.codigoEntidad).toBe(BREB_ENTITY_CODES.FINTECH_SIMULATED);
  });

  it('strips entity prefix from account_id', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.pagador.numeroCuenta).toBe('900123456-1');
    expect(result.beneficiario.numeroCuenta).toBe('00098765');
  });

  it('uses alias value as llave when alias type is LLAVE_BREB', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.llave).toBe('+573001234567');
    expect(result.tipoLlave).toBe('TELEFONO');
  });

  it('uses creditor account as llave when alias is not LLAVE_BREB', () => {
    const canonical = makeCanonical({ alias: { type: 'CLABE', value: '002180012345678901' } });
    const result = canonicalToBreBPayload(canonical);
    expect(result.llave).toBe('00098765'); // stripped creditor account
  });

  it('infers tipoLlave NIT from NIT format', () => {
    const canonical = makeCanonical({ alias: { type: 'LLAVE_BREB', value: '900123456-1' } });
    const result = canonicalToBreBPayload(canonical);
    expect(result.tipoLlave).toBe('NIT');
  });

  it('infers tipoLlave EMAIL from email format', () => {
    const canonical = makeCanonical({ alias: { type: 'LLAVE_BREB', value: 'ana@email.com' } });
    const result = canonicalToBreBPayload(canonical);
    expect(result.tipoLlave).toBe('EMAIL');
  });

  it('infers tipoLlave ALIAS for unknown formats', () => {
    const canonical = makeCanonical({ alias: { type: 'LLAVE_BREB', value: 'mialias123' } });
    const result = canonicalToBreBPayload(canonical);
    expect(result.tipoLlave).toBe('ALIAS');
  });

  it('maps NIT taxId to pagador.nit', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.pagador.nit).toBe('900123456-1');
    expect(result.pagador.cc).toBeUndefined();
  });

  it('maps CC taxId to pagador.cc (no hyphen)', () => {
    const canonical = makeCanonical({
      debtor: {
        account_id: '26264220/12345678',
        name: 'Carlos',
        taxId: '12345678',
        accountType: 'CACC',
      },
    });
    const result = canonicalToBreBPayload(canonical);
    expect(result.pagador.cc).toBe('12345678');
    expect(result.pagador.nit).toBeUndefined();
  });

  it('truncates nombre to 140 chars', () => {
    const longName = 'A'.repeat(200);
    const canonical = makeCanonical({ debtor: { ...makeCanonical().debtor, name: longName } });
    const result = canonicalToBreBPayload(canonical);
    expect(result.pagador.nombre.length).toBeLessThanOrEqual(140);
  });

  it('uses remittanceInfo as concepto when available', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.concepto).toBe('Pago servicio');
  });

  it('falls back to reference as concepto when no remittanceInfo', () => {
    const canonical = makeCanonical({ remittanceInfo: undefined });
    const result = canonicalToBreBPayload(canonical);
    expect(result.concepto).toBe('PMT-01J8ABCDEF0001');
  });

  it('maps created_at to fechaHora', () => {
    const result = canonicalToBreBPayload(makeCanonical());
    expect(result.fechaHora).toBe('2023-06-01T12:00:00.000Z');
  });
});

describe('generateBrebTransactionId', () => {
  it('generates exactly 32 chars', () => {
    const id = generateBrebTransactionId();
    expect(id).toHaveLength(32);
  });

  it('starts with BR', () => {
    const id = generateBrebTransactionId();
    expect(id.startsWith('BR')).toBe(true);
  });

  it('contains codigoEntidad at positions 2-9', () => {
    const id = generateBrebTransactionId('26264220');
    expect(id.substring(2, 10)).toBe('26264220');
  });

  it('matches the BR{8}{8}{4}{10} pattern', () => {
    const id = generateBrebTransactionId();
    expect(id).toMatch(/^BR\d{8}\d{8}\d{4}[A-Z0-9]{10}$/);
  });

  it('generates unique IDs on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateBrebTransactionId()));
    expect(ids.size).toBe(100);
  });
});
