import { BREB_ENTITY_CODES, generateBrebTransactionId, type BreBPaymentRequest } from './types.js';

interface CanonicalPacs008 {
  payment_id: string;
  amount: { value: number; currency: string };
  fx?: { source_currency?: string; rate?: number };
  debtor: {
    account_id: string;
    name?: string;
    taxId?: string;
    accountType?: string;
  };
  creditor: {
    account_id: string;
    name?: string;
    taxId?: string;
    accountType?: string;
  };
  alias: { type: string; value: string };
  purpose?: string;
  reference?: string;
  remittanceInfo?: string;
  origin: { rail: string; ispb?: string };
  destination: { rail?: string; ispb?: string };
  trace_id?: string;
  created_at: string;
}

/**
 * Maps the canonical pacs.008 model to a Bre-B SPI payment request.
 *
 * FX: canonical amounts may be in any currency; Bre-B requires COP.
 * If fx.rate is present, apply it. Otherwise assume amount is already COP.
 */
export function canonicalToBreBPayload(canonical: CanonicalPacs008): BreBPaymentRequest {
  const fxRate = canonical.fx?.rate ?? 1;
  const localAmount = canonical.amount.value * fxRate;
  const amountStr = (Math.round(localAmount * 100) / 100).toFixed(2);

  const pagadorEntidad = canonical.origin.ispb ?? BREB_ENTITY_CODES.FINTECH_SIMULATED;
  const beneficiarioEntidad = canonical.destination.ispb ?? BREB_ENTITY_CODES.FINTECH_SIMULATED;

  // Strip entity prefix from account IDs if present ("codigoEntidad/account")
  const rawDebtorAccount = canonical.debtor.account_id;
  const debtorAccount = rawDebtorAccount.includes('/')
    ? rawDebtorAccount.split('/').slice(1).join('/')
    : rawDebtorAccount;

  const rawCreditorAccount = canonical.creditor.account_id;
  const creditorAccount = rawCreditorAccount.includes('/')
    ? rawCreditorAccount.split('/').slice(1).join('/')
    : rawCreditorAccount;

  // Llave: use alias value if LLAVE_BREB, otherwise use creditor account
  const rawLlave = canonical.alias.type === 'LLAVE_BREB'
    ? canonical.alias.value
    : creditorAccount;
  const llave = rawLlave.replace(/^BREB-/, '');

  // Derive key type from alias format
  let tipoLlave: 'TELEFONO' | 'NIT' | 'EMAIL' | 'ALIAS' = 'ALIAS';
  if (/^\+57\d{10}$/.test(llave)) tipoLlave = 'TELEFONO';
  else if (/^\d{9,10}-\d$/.test(llave)) tipoLlave = 'NIT';
  else if (llave.includes('@')) tipoLlave = 'EMAIL';

  const idTransaccion = generateBrebTransactionId(pagadorEntidad);

  return {
    idTransaccion,
    valor: { original: amountStr },
    pagador: {
      codigoEntidad: pagadorEntidad,
      nombre: (canonical.debtor.name ?? 'REMITENTE').substring(0, 140),
      nit: canonical.debtor.taxId?.includes('-') ? canonical.debtor.taxId : undefined,
      cc: canonical.debtor.taxId && !canonical.debtor.taxId.includes('-')
        ? canonical.debtor.taxId
        : undefined,
      numeroCuenta: debtorAccount,
      tipoCuenta: (canonical.debtor.accountType as 'CACC' | 'SVGS' | 'TRAN') ?? 'CACC',
    },
    beneficiario: {
      codigoEntidad: beneficiarioEntidad,
      nombre: (canonical.creditor.name ?? 'BENEFICIARIO').substring(0, 140),
      nit: canonical.creditor.taxId?.includes('-') ? canonical.creditor.taxId : undefined,
      cc: canonical.creditor.taxId && !canonical.creditor.taxId.includes('-')
        ? canonical.creditor.taxId
        : undefined,
      numeroCuenta: creditorAccount,
      tipoCuenta: (canonical.creditor.accountType as 'CACC' | 'SVGS' | 'TRAN') ?? 'CACC',
    },
    llave,
    tipoLlave,
    concepto: (canonical.remittanceInfo ?? canonical.reference ?? 'MIPIT-POC').substring(0, 140),
    fechaHora: canonical.created_at,
  };
}
