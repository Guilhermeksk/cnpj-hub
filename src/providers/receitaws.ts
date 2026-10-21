import { CnpjNotFoundError, ProviderError } from '../errors.js';
import type { Provider } from '../types.js';
import { getJson } from './http.js';
import * as n from './normalize.js';

interface ReceitaWsResponse {
  status: 'OK' | 'ERROR';
  message?: string;
  nome?: string;
  fantasia?: string;
  situacao?: string;
  tipo?: string;
  abertura?: string;
  natureza_juridica?: string;
  porte?: string;
  capital_social?: string;
  atividade_principal?: Array<{ code: string; text: string }>;
  atividades_secundarias?: Array<{ code: string; text: string }>;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  telefone?: string;
  email?: string;
  simples?: { optante?: boolean | null } | null;
  simei?: { optante?: boolean | null } | null;
  qsa?: Array<{ nome: string; qual?: string }>;
}

export interface ReceitaWsOptions {
  baseUrl?: string;
  /** Token for the paid plan. Sent as `Authorization: Bearer <token>`. */
  token?: string;
}

const NOT_FOUND_MESSAGE = /inv[aá]lido|n[aã]o encontrado|rejeitado/i;

/**
 * [ReceitaWS](https://receitaws.com.br) — the free tier allows 3 requests per minute,
 * but it often has fresher data than the open-data based providers.
 */
export function receitaWs(options: ReceitaWsOptions = {}): Provider {
  const baseUrl = options.baseUrl ?? 'https://receitaws.com.br/v1/cnpj';
  const name = 'receitaws';
  const headers: Record<string, string> = options.token
    ? { authorization: `Bearer ${options.token}` }
    : {};

  return {
    name,
    async lookup(cnpj, context) {
      const data = await getJson<ReceitaWsResponse>(
        { provider: name, cnpj, url: `${baseUrl}/${cnpj}`, headers },
        context,
      );

      // ReceitaWS answers 200 with `status: "ERROR"` for unknown/rejected CNPJs.
      if (data.status !== 'OK') {
        if (data.message && NOT_FOUND_MESSAGE.test(data.message)) {
          throw new CnpjNotFoundError(cnpj, name);
        }
        throw new ProviderError({ provider: name, message: data.message ?? 'erro desconhecido' });
      }

      const legalName = n.text(data.nome);
      if (!legalName)
        throw new ProviderError({ provider: name, message: 'resposta sem razão social' });
      const [main] = data.atividade_principal ?? [];

      return {
        cnpj,
        legalName,
        tradeName: n.text(data.fantasia),
        status: n.upper(data.situacao),
        branchType: n.branchType(data.tipo),
        openedAt: n.isoDate(data.abertura),
        legalNature: n.stripCode(data.natureza_juridica),
        size: n.upper(data.porte),
        shareCapital: n.amount(data.capital_social),
        mainActivity: main ? n.activity(main.code, main.text) : null,
        secondaryActivities: n.activities(
          data.atividades_secundarias?.map((a) => ({ code: a.code, description: a.text })),
        ),
        address: {
          street: n.text(data.logradouro),
          number: n.text(data.numero),
          complement: n.text(data.complemento),
          district: n.text(data.bairro),
          zipCode: n.digits(data.cep),
          city: n.text(data.municipio),
          state: n.upper(data.uf),
        },
        phones: n.phones(data.telefone),
        email: n.email(data.email),
        simples: n.yesNo(data.simples?.optante),
        mei: n.yesNo(data.simei?.optante),
        partners: (data.qsa ?? []).map((p) => ({
          name: n.text(p.nome) ?? '',
          role: n.stripCode(p.qual),
          since: null,
        })),
        source: name,
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}
