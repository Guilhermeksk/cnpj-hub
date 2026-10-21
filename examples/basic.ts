// Run with: npm run build && node --experimental-strip-types examples/basic.ts
import { AllProvidersFailedError, CnpjHub, CnpjNotFoundError, InvalidCnpjError } from 'cnpj-hub';

const hub = new CnpjHub({
  strategy: 'fallback',
  timeoutMs: 8_000,
  onEvent: (event) => {
    if (event.type === 'failure') console.warn(`[${event.provider}] ${event.error.message}`);
  },
});

try {
  const company = await hub.lookup('00.000.000/0001-91');
  console.log(`${company.legalName} — ${company.status} (via ${company.source})`);
  console.log(`${company.address.city}/${company.address.state}`);
} catch (error) {
  if (error instanceof InvalidCnpjError) console.error('CNPJ inválido');
  else if (error instanceof CnpjNotFoundError) console.error('CNPJ não existe');
  else if (error instanceof AllProvidersFailedError)
    console.error('Provedores fora do ar', error.errors);
  else throw error;
}

// Lote com concorrência limitada — nunca rejeita, cada item diz se deu certo.
const results = await hub.lookupMany(['11.222.333/0001-81', '123'], { concurrency: 2 });
for (const result of results) {
  console.log(
    result.ok ? `✔ ${result.company.legalName}` : `✖ ${result.input}: ${result.error.message}`,
  );
}
