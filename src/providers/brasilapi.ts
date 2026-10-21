import { ProviderError } from '../errors.js';
import type { Provider } from '../types.js';
import { getJson } from './http.js';
import * as n from './normalize.js';

interface BrasilApiResponse {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string | null;
  descricao_situacao_cadastral?: string | null;
  descricao_identificador_matriz_filial?: string | null;
  data_inicio_atividade?: string | null;
  natureza_juridica?: string | null;
  porte?: string | null;
  capital_social?: number | null;
  cnae_fiscal?: number | null;
  cnae_fiscal_descricao?: string | null;
  cnaes_secundarios?: Array<{ codigo: number; descricao: string }> | null;
  descricao_tipo_de_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cep?: string | null;
  municipio?: string | null;
  uf?: string | null;
  ddd_telefone_1?: string | null;
  ddd_telefone_2?: string | null;
  email?: string | null;
  opcao_pelo_simples?: boolean | null;
  opcao_pelo_mei?: boolean | null;
  qsa?: Array<{
    nome_socio: string;
    qualificacao_socio?: string | null;
    data_entrada_sociedade?: string | null;
  }> | null;
}

export interface BrasilApiOptions {
  baseUrl?: string;
}

/** [BrasilAPI](https://brasilapi.com.br) — free, no token, data from Receita Federal open data. */
export function brasilApi(options: BrasilApiOptions = {}): Provider {
  const baseUrl = options.baseUrl ?? 'https://brasilapi.com.br/api/cnpj/v1';
  const name = 'brasilapi';

  return {
    name,
    async lookup(cnpj, context) {
      const data = await getJson<BrasilApiResponse>(
        { provider: name, cnpj, url: `${baseUrl}/${cnpj}` },
        context,
      );
      const legalName = n.text(data.razao_social);
      if (!legalName)
        throw new ProviderError({ provider: name, message: 'resposta sem razão social' });

      return {
        cnpj,
        legalName,
        tradeName: n.text(data.nome_fantasia),
        status: n.upper(data.descricao_situacao_cadastral),
        branchType: n.branchType(data.descricao_identificador_matriz_filial),
        openedAt: n.isoDate(data.data_inicio_atividade),
        legalNature: n.text(data.natureza_juridica),
        size: n.upper(data.porte),
        shareCapital: n.amount(data.capital_social),
        mainActivity: n.activity(data.cnae_fiscal, data.cnae_fiscal_descricao),
        secondaryActivities: n.activities(
          data.cnaes_secundarios?.map((a) => ({ code: a.codigo, description: a.descricao })),
        ),
        address: {
          street: n.joinText(data.descricao_tipo_de_logradouro, data.logradouro),
          number: n.text(data.numero),
          complement: n.text(data.complemento),
          district: n.text(data.bairro),
          zipCode: n.digits(data.cep),
          city: n.text(data.municipio),
          state: n.upper(data.uf),
        },
        phones: n.phones(data.ddd_telefone_1, data.ddd_telefone_2),
        email: n.email(data.email),
        simples: n.yesNo(data.opcao_pelo_simples),
        mei: n.yesNo(data.opcao_pelo_mei),
        partners: (data.qsa ?? []).map((p) => ({
          name: n.text(p.nome_socio) ?? '',
          role: n.text(p.qualificacao_socio),
          since: n.isoDate(p.data_entrada_sociedade),
        })),
        source: name,
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}
