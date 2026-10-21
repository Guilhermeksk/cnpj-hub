import { ProviderError } from '../errors.js';
import type { Provider } from '../types.js';
import { getJson } from './http.js';
import * as n from './normalize.js';

interface CnpjWsActivity {
  id?: string | null;
  subclasse?: string | null;
  descricao?: string | null;
}

interface CnpjWsResponse {
  razao_social?: string;
  capital_social?: string | null;
  porte?: { descricao?: string | null } | null;
  natureza_juridica?: { descricao?: string | null } | null;
  simples?: { simples?: string | null; mei?: string | null } | null;
  socios?: Array<{
    nome: string;
    data_entrada?: string | null;
    qualificacao_socio?: { descricao?: string | null } | null;
  }> | null;
  estabelecimento?: {
    tipo?: string | null;
    nome_fantasia?: string | null;
    situacao_cadastral?: string | null;
    data_inicio_atividade?: string | null;
    atividade_principal?: CnpjWsActivity | null;
    atividades_secundarias?: CnpjWsActivity[] | null;
    tipo_logradouro?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cep?: string | null;
    ddd1?: string | null;
    telefone1?: string | null;
    ddd2?: string | null;
    telefone2?: string | null;
    email?: string | null;
    cidade?: { nome?: string | null } | null;
    estado?: { sigla?: string | null } | null;
  } | null;
}

export interface CnpjWsOptions {
  baseUrl?: string;
  /** Token for the commercial API. Sent as the `x_api_token` header. */
  token?: string;
}

/** [CNPJ.ws](https://www.cnpj.ws) public API — free tier allows 3 requests per minute. */
export function cnpjWs(options: CnpjWsOptions = {}): Provider {
  const baseUrl =
    options.baseUrl ??
    (options.token ? 'https://comercial.cnpj.ws/cnpj' : 'https://publica.cnpj.ws/cnpj');
  const name = 'cnpjws';
  const headers: Record<string, string> = options.token ? { x_api_token: options.token } : {};

  return {
    name,
    async lookup(cnpj, context) {
      const data = await getJson<CnpjWsResponse>(
        { provider: name, cnpj, url: `${baseUrl}/${cnpj}`, headers },
        context,
      );
      const legalName = n.text(data.razao_social);
      if (!legalName)
        throw new ProviderError({ provider: name, message: 'resposta sem razão social' });
      const est = data.estabelecimento ?? {};
      const toActivity = (a: CnpjWsActivity) => ({
        code: a.id ?? a.subclasse,
        description: a.descricao,
      });

      return {
        cnpj,
        legalName,
        tradeName: n.text(est.nome_fantasia),
        status: n.upper(est.situacao_cadastral),
        branchType: n.branchType(est.tipo),
        openedAt: n.isoDate(est.data_inicio_atividade),
        legalNature: n.text(data.natureza_juridica?.descricao),
        size: n.upper(data.porte?.descricao),
        shareCapital: n.amount(data.capital_social),
        mainActivity: est.atividade_principal
          ? n.activity(toActivity(est.atividade_principal).code, est.atividade_principal.descricao)
          : null,
        secondaryActivities: n.activities(est.atividades_secundarias?.map(toActivity)),
        address: {
          street: n.joinText(est.tipo_logradouro, est.logradouro),
          number: n.text(est.numero),
          complement: n.text(est.complemento),
          district: n.text(est.bairro),
          zipCode: n.digits(est.cep),
          city: n.text(est.cidade?.nome),
          state: n.upper(est.estado?.sigla),
        },
        phones: n.phones(
          est.telefone1 ? `${est.ddd1 ?? ''}${est.telefone1}` : null,
          est.telefone2 ? `${est.ddd2 ?? ''}${est.telefone2}` : null,
        ),
        email: n.email(est.email),
        simples: n.yesNo(data.simples?.simples),
        mei: n.yesNo(data.simples?.mei),
        partners: (data.socios ?? []).map((p) => ({
          name: n.text(p.nome) ?? '',
          role: n.text(p.qualificacao_socio?.descricao),
          since: n.isoDate(p.data_entrada),
        })),
        source: name,
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}
