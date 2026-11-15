# Verificação AstroHealth v0.5

Execução em 15/11/2026, Windows, Python 3.12.14 da distribuição Codex, Node.js 24.22.1 e navegador integrado do Codex.

- **v0.3** — `python -B -m unittest discover -s work/legacy/AstroHealth -v` · **7 aprovados**. Execução local em 8766 e leitura de 31 eventos na API confirmadas.
- **v0.4** — `python -B -m unittest -v` na pasta do projeto · **17 aprovados** em 12,290 s na execução final da suíte. Cada caso usa SQLite temporário e um servidor HTTP em porta livre.
- **JavaScript** — `node --check web/app.js`, `node --check web/panels.js` e `node --check web/ui.js` passaram. `seriesPath` produziu dois segmentos para uma sequência com uma amostra nula no meio.

| Teste v0.4 | Evidência |
|---|---|
| T01 · Perda de leitura | Curva térmica inicial de 18 instantes; dois valores nulos com qualidade de desconexão e amostras válidas ao redor. |
| T02 · Unidade incompatível | HTTP 422, motivo no diário e contagem de registros preservada. |
| T03 · Horário inválido | HTTP 422 para texto inválido, horário sem fuso e data futura. |
| T04 · Ingestão concorrente | 16 inserções distribuídas por dois perfis em até seis tarefas concorrentes. IDs observados somente no perfil correspondente. |
| T05 · Dispositivo de outro perfil | HTTP 422, motivo no diário. |
| T06 · Queda durante envio | Enlace interrompido, fila preservada em erro recuperável e receptor vazio. |
| T07 · Confirmação perdida | Segunda tentativa por item; a contagem de IDs no receptor permaneceu igual. |
| T08 · Identificador em conflito | Original preservado; divergência no receptor classificada como conflito, sem recibo. |
| T09 · Reinício | Novo servidor e nova conexão aos mesmos bancos. Estados confirmados e preparados preservados. Transmissão preparada pôde ser concluída. |
| T10 · Falha de armazenamento | HTTP 503, sem confirmação de salvamento, sem novo registro e com falha injetada no diário. |
| T11 · Check-in durante interrupção | Registro autorizado persistiu em Apoio de bordo, registro desmarcado permaneceu local e revisão foi roteada para Controle de missão. |
| T12 · Sem protocolo | A API retornou `null`; a mensagem de indisponibilidade também foi observada na tela. |
| T13 · Troca de perfil | Históricos e exportações corresponderam ao perfil. Abrir sessão de outro perfil retornou HTTP 400. |
| T14 · Confirmação real do receptor local | Estado preparado e estado enviado permaneceram sem recibo. A consulta posterior confirmou IDs gravados e correspondentes. |
| T15 · Palmilha unilateral | Amostras de carga e passos do pé esquerdo tornaram-se nulas. A amostra direita continuou disponível. A confiança exibida baixou. |
| Roteiro completo | Sete avanços concluídos após a etapa de preparação. Check-in e revisão criados uma vez. Nova execução preservou as duas sessões anteriores. |
| Substituição | ID anterior revogado, histórico preservado e novo dispositivo aceito na mesma sessão. |

## Validação da interface

O navegador exibiu a curva com lacuna, a inspeção de ponto por teclado, a origem sintética e os campos de captura e recebimento. O roteiro passou pela queda de enlace, chegada com zero confirmações, confirmação de 134 registros no cenário exercitado e recuperação. Foram verificados o check-in manual persistente, o filtro da fila, a troca de perfil, a falha unilateral, a navegação pelas onze áreas e os controles Voltar, Reproduzir e Pausar. O layout a 390 px abriu o menu móvel e exibiu a tela sem rolagem horizontal.

Durante a inspeção, um seletor de teste procurou a palavra “Reduzida” por função em vez de texto. A nova leitura do painel confirmou a confiança reduzida. A idade dos cartões foi corrigida de milissegundos para minutos e conferida no painel recarregado. A última inspeção do console não mostrou erros de JavaScript.

Os casos físicos de perda de energia e disco cheio, ensaios clínicos e certificação de hardware ficaram fora do teste. A verificação de acessibilidade cobriu teclado, rótulos, foco e tabela alternativa no navegador integrado. Ficaram pendentes leitores de tela dedicados, outros navegadores e testes com usuários.


## Verificação do módulo ambiental v0.5

Comando: `python -B -m unittest -v` na pasta da aplicação. **39 casos aprovados**, incluindo 22 novos testes de conectores, transporte e integração local e os 17 casos do demonstrador anterior. Os testes de provedores usam fixtures e não consomem cotas.

| Caso | Resultado observado | Tipo |
|---|---|---|
| STAC válido | Normalizou região, aquisição, resolução, nuvens, fonte e prévia. Uma coleção vazia voltou como sucesso sem resultados. | Fixture |
| Região ou intervalo inválido | A busca foi bloqueada antes de consultar a origem. | Fixture |
| STAC sem rede | Retornou `offline`, com dados externos indisponíveis sem cache. O cenário fisiológico iniciou em seguida. | Fixture em HTTP local e navegador com rede externa bloqueada |
| SAS expirado | Solicitou assinatura nova uma vez. Uma segunda recusa entrou em estado de acesso temporário expirado. | Fixture |
| Meteomatics sem credenciais | Nenhuma requisição enviada. Interface exibiu “Meteomatics não configurada”. | Fixture e navegador |
| Credenciais inválidas | HTTP 401 virou acesso negado. Sinais de segredo foram omitidos do retorno. | Transporte simulado |
| EURO1k fora da região | São Paulo foi recusado para esse modelo antes da consulta. Lisboa enviou a seleção explícita de EURO1k com fixture. | Fixture e navegador |
| Limite de uso | HTTP 429 preservou `Retry-After`. A pausa atingiu clima e Kp da mesma conta. Uma consulta posterior retomou normalmente. | Transporte simulado |
| Dados antigos | Horário de validade permaneceu visível e a amostra recebeu estado desatualizado. | Fixture |
| NASA DONKI sem evento | Retornou sucesso vazio. | Fixture e chamada pública direta GST em 01/01/2000 |
| Resposta malformada | JSON corrompido, HTML inesperado e GeoJSON estruturalmente inválido falharam no conector afetado. Os outros responderam. | Fixture e transporte simulado |
| Cache | Reinício preservou a busca Landsat. Testados cache vigente, cache antigo após queda, expiração, busca vazia que invalida cache anterior e ausência de cache para MODIS. | SQLite temporário com fixtures |
| Navegador | Estados offline, configuração, cobertura e simulação exibidos por separado. A fase de exercício abriu e avançou após a falha do DONKI. Em 390 px, uma coluna e sem rolagem horizontal. Console sem erros na inspeção final. | Navegador com servidor local |
| Sintaxe e renderização | Os módulos JavaScript passaram por `node --check`. Uma fixture de cache exibiu origem externa, indicação de cache e cenário simulado em elementos distintos. | Node.js local |

Resultados reais das chamadas públicas, do bloqueio de rede do servidor e da falta de credenciais constam em [AMBIENTE.md](AMBIENTE.md).
