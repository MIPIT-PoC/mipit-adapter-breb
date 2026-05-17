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

  // P04 — Full BanRep llave taxonomy. Inference is best-effort; explicit
  // `tipoLlave` from canonical takes precedence if provided. ALIAS is the
  // catch-all default for unrecognized formats (preserves backward compat
  // with consumers that pass arbitrary user-defined aliases).
  let tipoLlave: 'CC' | 'CE' | 'NIT' | 'PASAPORTE' | 'TELEFONO' | 'EMAIL' | 'ALIAS' = 'ALIAS';
  if (/^\+573\d{9}$/.test(llave)) tipoLlave = 'TELEFONO'; // mobile only (+57 3xx)
  else if (/^\d{9,10}-\d$/.test(llave)) tipoLlave = 'NIT';
  else if (/^@[a-zA-Z0-9._]{3,19}$/.test(llave)) tipoLlave = 'ALIAS'; // explicit @-prefix
  else if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(llave)) tipoLlave = 'EMAIL';
  // PASAPORTE: very specific — uppercase letters followed by digits (Colombian
  // passport convention, e.g. "AB123456"). Won't match lowercase strings.
  else if (/^[A-Z]{1,3}\d{5,10}$/.test(llave)) tipoLlave = 'PASAPORTE';
  else if (/^\d{6,7}$/.test(llave)) tipoLlave = 'CE'; // shorter — CE
  else if (/^\d{8,10}$/.test(llave)) tipoLlave = 'CC'; // 8-10 digits — CC (CE handled above)
  // else keep ALIAS as the safe default for unrecognized formats

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
