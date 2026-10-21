# Contribuindo

Obrigado pelo interesse! Issues e pull requests são bem-vindos.

## Ambiente

Requisitos: Node.js 22 ou superior.

```bash
git clone https://github.com/Guilhermeksk/cnpj-hub.git
cd cnpj-hub
npm install
npm test
```

## Scripts

| Comando             | O que faz                                  |
| ------------------- | ------------------------------------------ |
| `npm test`          | Compila e roda os testes (`node:test`)     |
| `npm run coverage`  | Testes com relatório de cobertura          |
| `npm run lint`      | Lint + formatação com Biome                |
| `npm run lint:fix`  | Corrige o que for possível automaticamente |
| `npm run typecheck` | Checagem de tipos                          |
| `npm run build`     | Gera `dist/`                               |

## Diretrizes

- Os testes **não** acessam a internet: use `jsonFetch` e `fakeProvider` de `test/helpers.ts`.
- Novos provedores ficam em `src/providers/`, devolvem o tipo `Company` normalizado e
  lançam `CnpjNotFoundError` / `ProviderError` conforme o caso. Inclua um payload de
  exemplo (fictício) em `test/fixtures.ts`.
- Mantenha a biblioteca sem dependências de runtime.
- Commits no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/)
  (`feat:`, `fix:`, `docs:`...).
- Atualize o `CHANGELOG.md` quando a mudança afetar quem usa a biblioteca.
