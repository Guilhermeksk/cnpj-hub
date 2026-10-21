# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-10-21

### Adicionado

- Cliente `CnpjHub` com fallback entre BrasilAPI, CNPJ.ws e ReceitaWS.
- Estratégia `race` (primeira resposta vence, demais requisições são canceladas).
- Retry com backoff exponencial + jitter, respeitando `Retry-After`.
- Timeout por tentativa, cancelamento via `AbortSignal` e deduplicação de consultas simultâneas.
- Cache LRU em memória com TTL e interface para caches externos (Redis etc.).
- Validação, formatação e geração de CNPJ, incluindo o formato alfanumérico (2026).
- CLI (`cnpj-hub`) com consulta, validação, lote para CSV/JSON e servidor HTTP.
- Imagem Docker para a API HTTP.
