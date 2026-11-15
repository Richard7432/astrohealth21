# Ambiente da missão · AstroHealth v0.5

Em **Ambiente da missão**, escolha a região e o intervalo e clique em **Buscar cenas**. Para o clima terrestre, escolha o local, o modelo e a validade. Em **Clima espacial**, consulte o índice Kp ou selecione um tipo de evento DONKI. As consultas externas ocorrem somente ao acionar esses controles. O roteiro de exercício e recuperação permanece local.

As telas identificam dados externos, resultados anteriores em cache, telemetria fisiológica sintética e dados externos indisponíveis. **Ver cenário ambiental simulado** abre um exemplo fictício de apresentação. Essa opção não preenche uma consulta externa que falhou.

## Fontes, custos e permissões

| Conector | Dados e cobertura | Acesso, custo e atribuição |
|---|---|---|
| Planetary Computer / STAC | Landsat Collection 2 Level-2 e MODIS 09A1 6.1. Os catálogos têm abrangência global, com cobertura, datas e resolução dependentes dos produtos e cenas. | Catálogo público anônimo. As cotas de tráfego e a validade SAS dependem do serviço e do nível de acesso. Landsat é produzido por NASA e USGS, com processamento USGS. MODIS 09A1 é fornecido pelo NASA LP DAAC no USGS EROS. Microsoft hospeda o catálogo e processa ativos MODIS conforme os metadados. [Catálogo Landsat](https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2) · [Catálogo MODIS](https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-09A1-061) · [Tokens SAS](https://planetarycomputer.microsoft.com/docs/concepts/sas/) |
| Meteomatics · clima terrestre | Temperatura do ar, umidade, pressão ao nível do mar, vento, precipitação em 1 h e nuvens para um ponto. **Mix** combina fontes e tem cobertura global dependente do produto. **EURO1k** é previsão numérica da Meteomatics com resolução nativa de 1 km na Europa e em partes do Norte da África. | HTTP Basic por HTTPS no servidor. Credenciais, variáveis, modelo, cotas e preços dependem do plano. Confirme os direitos de uso e redistribuição no seu contrato antes de publicar saídas. [Planos e preços](https://www.meteomatics.com/en/pricing/) · [Modelos](https://www.meteomatics.com/en/api/request/optional-parameters/data-source/) · [EURO1k](https://www.meteomatics.com/en/weather-model-europe/) · [Estatísticas e cotas](https://www.meteomatics.com/en/api/request/) · [Termos da Meteomatics GmbH](https://www.meteomatics.com/files/Terms-Conditions/General-Terms-and-Conditions-of-Meteomatics-GmbH.pdf) |
| Meteomatics · Kp | Índice geomagnético planetário de 0 a 9, de observação e previsão da NOAA SWPC. O painel usa `kp:idx` e seleciona `noaa-swpc`. | Mesmas credenciais da Meteomatics e permissão para o parâmetro. Atribuição NOAA SWPC com acesso pela Meteomatics. [Parâmetro e fonte](https://www.meteomatics.com/en/api/available-parameters/space-weather/) |
| NASA DONKI | Eventos FLR, GST e CME em base pública de análises e registros. Sem garantia de completude ou adequação operacional. | Rota pública padrão do NASA CCMC, sem chave. A opção NASA Open APIs aceita uma chave no servidor. A rota antiga retornou HTTP 404 no teste com `DEMO_KEY`. A documentação do gateway registra 30 consultas por hora e 50 por dia por IP para a chave de demonstração. Use a rota CCMC. Atribuição NASA DONKI / CCMC. [Migração oficial](https://ccmc.gsfc.nasa.gov/news/major-updates/) · [DONKI e política de uso](https://ccmc.gsfc.nasa.gov/tools/DONKI/) · [Cotas NASA Open APIs](https://api.nasa.gov/assets/html/authentication.html) |

## Configuração local

O arquivo `.env.example` lista as variáveis. O programa lê **variáveis de ambiente do processo**. Para ativar a Meteomatics, use a mesma janela de PowerShell para informar suas credenciais e iniciar o site. O exemplo pede os valores localmente.

```powershell
$env:METEOMATICS_USERNAME = Read-Host 'Usuário Meteomatics'
$mmSecret = Read-Host 'Senha Meteomatics' -AsSecureString
$env:METEOMATICS_PASSWORD = [System.Net.NetworkCredential]::new('', $mmSecret).Password
.\Iniciar.cmd
```

| Variável | Como usar |
|---|---|
| `METEOMATICS_USERNAME` e `METEOMATICS_PASSWORD` | Necessárias para clima e Kp. O painel mostra **Meteomatics não configurada** até que ambas estejam presentes no processo. Reinicie o servidor para aplicar alterações. |
| `NASA_DONKI_SOURCE` | Padrão `ccmc`, com o endpoint público atual. A opção `open-api` é experimental devido ao 404 observado e usa o endereço `api.nasa.gov/DONKI`. A escolha é explícita. |
| `NASA_API_KEY` | Opcional. Usada apenas com `NASA_DONKI_SOURCE=open-api`. Configure somente na sessão local do servidor. |
| `ASTRO_LANDSAT_CACHE` | Padrão `1` para metadados Landsat. Use `0` para desativar a leitura e a escrita desse cache. |

Planetary Computer e CCMC exigem que o processo Python tenha saída HTTPS. O módulo usa apenas os hosts e operações previstos para cada provedor. A aplicação local continua acessível se qualquer consulta externa falhar.

## O que o painel interpreta

- **STAC** usa oeste, sul, leste e norte em graus, sem cruzar o antimeridiano. O intervalo aceita até 93 dias e a área até 30° por 30°. O painel exibe até oito resultados e sinaliza se há mais. Captura ou composição, resolução, nuvens e processamento são apresentados conforme o item ou a resolução nominal identificada da coleção.
- **Miniaturas** vêm do ativo de prévia informado no item. O servidor usa o renderizador oficial ou solicita SAS ao Microsoft Planetary Computer para uma miniatura raster Azure. O servidor tenta renovar uma vez após recusa de acesso do ativo. As respostas são limitadas a 2 MB. O AstroHealth exibe a prévia do catálogo em PNG, JPEG ou WebP. Arquivos COG, bandas e imagens de resolução integral ficam fora do painel. [API de prévias do Planetary Computer](https://planetarycomputer.microsoft.com/api/data/v1/docs)
- **Meteorologia** mostra modelo pedido e modelo efetivamente informado, horários UTC de validade dos valores e da consulta. A geração da resposta e a inicialização do modelo aparecem quando retornadas. O Mix pode combinar reanálises, observações ou modelos. Se o tipo estiver ausente na resposta, aparece **Não informado**. EURO1k é previsão regional e a triagem geográfica aproximada bloqueia pontos evidentemente fora da região. A origem decide a disponibilidade para pontos próximos das bordas. Ao escolher outro modelo, faça nova consulta. As janelas visuais de uma hora para o clima e de quatro horas para Kp são critérios indicativos do painel.
- **DONKI** apresenta até 30 resultados por tipo e intervalo (máximo de 31 dias). Origem, horário de início e demais horários são do registro oficial. Kp anexado a uma tempestade é mostrado com a fonte registrada no evento. Ausência no intervalo significa que o serviço não devolveu eventos para a consulta.

Esses dados descrevem ambientes terrestres e geoespaciais. A imagem e a meteorologia podem representar tempos e métodos diferentes. Kp descreve a perturbação geomagnética terrestre. Os dados não estabelecem dose individual, exposição dentro da nave, diagnóstico nem ordem operacional. O módulo fica fora da fila, da lógica fisiológica e das exportações sintéticas.

## Cache e indisponibilidade

- O arquivo local `environment-cache.sqlite` guarda **somente metadados normalizados de buscas Landsat**, cuja coleção vincula a política de domínio público. A chave usa coleção, área e datas. Validade local de seis horas, retenção de até sete dias na limpeza de consultas e limite de 96 seleções. Imagens, tokens, JSON bruto e históricos de consultas meteorológicas ou DONKI ficam fora do cache persistente. [Licença indicada na coleção Landsat](https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2) · [Política USGS](https://www.usgs.gov/core-science-systems/hdds/data-policy) · [Termos do Planetary Computer](https://planetarycomputer.microsoft.com/terms)
- **Atualizar na fonte** tenta consultar o catálogo novamente. Uma falha recuperável pode exibir o último resultado autorizado para **a mesma seleção**, com hora original, idade, indicação de cache antigo quando aplicável e motivo da falha. Uma busca válida que retorna vazia invalida a versão anterior para essa seleção.
- Cada consulta tem limite local de tamanho e timeout de conexão/leitura. O servidor permite uma consulta em andamento por provedor e aplica uma pausa de quatro segundos por operação. HTTP 429 ativa espera compartilhada pelo provedor conforme `Retry-After`, com margem local de 10 s a 24 h e padrão de 60 s quando ausente. Consultas aguardando a liberação são sinalizadas na tela.
- Estado **Conectado** requer uma resposta válida com resultados. Resultados vazios, credenciais ausentes, acesso negado, erro, resposta malformada, cache e pausa têm estados próprios. A fonte pode funcionar no navegador e ainda estar inacessível ao processo Python se houver bloqueio de rede local.

## Verificações reais

| Fonte | Resultado em 15/11/2026 |
|---|---|
| STAC público, pelo navegador | Landsat e MODIS devolveram `FeatureCollection` com o limite de um item solicitado em Lisboa, de 01 a 30/06/2024. Foram observados `LC09_L2SP_204033_20240626_02_T1` e `MYD09A1.A2024177.h17v05.061.2024186043804`. A prévia Landsat abriu em PNG com 1009 px de largura. |
| NASA CCMC, pelo navegador | Para 10 a 11/05/2024, retornou 28 FLR, 1 GST e 11 CME. A consulta GST de 01/01/2000 retornou lista vazia. |
| NASA Open APIs, pelo navegador | `/DONKI/FLR` retornou HTTP 404 com a chave pública `DEMO_KEY`. Chave pessoal ficou sem teste. O conector usa CCMC por padrão. |
| Processo Python local | A saída HTTPS do ambiente de execução foi bloqueada. A interface apresentou ausência de conexão e os fluxos locais continuaram executáveis. Os adaptadores e a rota local foram verificados com fixtures nos testes. |
| Meteomatics | Conexão autenticada não executada por falta de usuário e senha. A saída do EURO1k em conta real e a disponibilidade de Kp dependem das permissões. |

As chamadas públicas verificadas serviram como evidência de disponibilidade e formato. Nenhum retorno externo ou cache pré-carregado acompanha o ZIP. Consulte [TESTES.md](TESTES.md) para reproduzir a verificação local.

