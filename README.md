# AstroHealth Central Computer · v0.5.1

Demonstrador educacional para o NASA Space Apps Challenge. O AHCC mostra como uma tripulação fictícia acompanha um exercício, identifica a perda de sinal, registra um check-in e confere o recebimento no destino simulado.

[Abrir a versão pública do AstroHealth](https://astrohealth-missao.sheilaarnore.chatgpt.site/)

O repositório `astrohealth21` reúne a interface compartilhada em `web/`, o servidor local Python na raiz e o Worker da versão pública em `hosting/`. Cada versão tem seus próprios testes e instruções de execução. [Backend publicado](hosting/README.md)

## Executar

- **Windows** — extraia o ZIP inteiro e abra **Iniciar.cmd**. O programa usa o Python do Codex quando está disponível, ou procura um Python do sistema.
- **Terminal** — na pasta extraída, execute `python -B server.py --open` (em alguns sistemas, `python3`). Requer Python 3.10+ e um navegador atual. Abra [o painel local](http://127.0.0.1:8765/) com o servidor em execução.
- **Encerrar** — Ctrl+C no terminal. A pasta `data` é criada na primeira execução e preservada. Uma execução independente pode usar `python -B server.py --port 8767 --data-dir data-novo --open`.

A aplicação escuta em `127.0.0.1`. Bibliotecas, imagens do cenário e fontes do sistema são locais. O roteiro fisiológico funciona sem internet. **Ambiente da missão** consulta as fontes externas sob demanda. Veja [fontes, credenciais, cache e validação das APIs](AMBIENTE.md).

## Roteiro de apresentação

1. Na **Visão geral**, mostre a indicação de dados sintéticos e abra **Iniciar demonstração**.
2. Avance de **Preparação** para **Exercício**. Em **Perda de sinal**, selecione um marcador de lacuna e compare captura, recebimento, origem e qualidade.
3. Avance até **Check-in e apoio** e **Interrupção do enlace**. O check-in fica localmente disponível e a revisão entra na fila. O roteiro mostra que o protocolo está indisponível.
4. Em **Retorno do enlace**, abra **Comunicação e fila** para mostrar o estado **Enviado · aguarda confirmação**. Volte ao roteiro e avance para **Confirmação**. A gravação correspondente no receptor fictício permite a mudança de estado.
5. Avance para **Recuperação**. O gráfico mantém a lacuna. Troque o perfil para verificar o histórico separado. **Voltar** revisita o texto da etapa. **Pausar** interrompe o avanço automático. **Reiniciar em nova sessão** preserva as sessões anteriores.

Frase para abertura do pitch: *Quando a telemetria some durante um exercício fictício, o AstroHealth mostra a ausência, registra o contexto a bordo e preserva a fila até verificar o recibo.*

## Inventário e evolução

| Item | Identificação | Verificação |
|---|---|---|
| Versão local anterior | `AstroHealth_Prototipo_Local_Codigo.zip` da entrega de 14/11; README v0.3; SHA-256 `D45F86765249D3CF163AACA36E9EF6D9876BDF34F09FFAE0E4FF3309A44C8D33` | Arquivo extraído em cópia de trabalho. Servidor abriu na porta 8766. API retornou 31 amostras e enlace interrompido. Os sete testes passaram. [Pacote original](https://drive.google.com/file/d/1ghLyiu7bgQJPYzPQsR4mXe2tb7KwaIky/view) |
| Documentos e evidências | Relatórios técnicos PT e EN; especificação de sensores v1.0; relatório do protótipo v0.2; verificação da entrega anterior | Documentos do Drive consultados e extrações locais dos PDFs conferidas. O relatório de verificação registrava sete testes aprovados. [PT](https://docs.google.com/document/d/1xnlO9vzH2Rqa6rLi2zNar4cvHqUBFPivjnouWiTsudw) · [EN](https://docs.google.com/document/d/1RzLts1ZHJp9eobL6G-M557in1oP2X3dhoQ8eRc4Pp7k) · [Especificação](https://docs.google.com/document/d/1YaOM8F6KyejuQOK2ZRGacPiiqvso3pc3s_8YyzrapgI) |
| Dados da v0.3 | Série gerada por `seed()`; fila só de leituras; check-ins e auditoria locais | O ZIP contém código e testes. Os bancos foram gerados na execução. |
| Repositório anterior | Commit `6d74b70217e745d51b1c9f635fe32a06c0df11dd` | Estado do repositório descrito nos relatórios. O commit remoto ficou sem verificação nesta execução. |
| v0.4 | `server.py`, `mission.py`, `storage.py`, `telemetry.py`, `web/`, `test_mission.py` | Evolução da base local em Python e SQLite. O esquema v0.4 usa arquivos próprios. Sessões e bancos v0.3 exigiriam migração explícita. |
| v0.5 | `environment/`, `web/environment.js`, `test_environment.py`, `.env.example` | Contexto ambiental separado da telemetria. Reutiliza a pasta de dados v0.4. Ao extrair em outra pasta, aponte `--data-dir` para a pasta de dados anterior para manter as sessões. |
| v0.5.1 | Interface e fotografia de arquivo | Painel de bordo em grafite e marfim, com destaque laranja e foto Earthrise. Reutiliza a pasta de dados v0.5. |

## Arquitetura e regras

**Geradores e controles fictícios → associação e validação → SQLite local + fila → enlace simulado → segundo SQLite → verificação do recibo.**

- `telemetry.py` define catálogos e curvas determinísticas por tripulante. A inicialização cria dois perfis com seis dispositivos e 18 instantes por sessão. Valores e posições das lacunas são reproduzíveis. IDs e horários são próprios de cada execução.
- `mission.py` valida perfil, sessão, dispositivo, métrica, unidade, origem, fuso, sequência e faixa instrumental sintética. Horários mais de 120 segundos no futuro são rejeitados. Valores ausentes usam `null`; origem sintética pode coexistir com métrica estimada. A rejeição é auditada. A visualização distingue captura e recepção; a idade acima de cinco minutos rotula o cartão como histórico para fins de demonstração.
- `storage.py` cria os esquemas SQLite. Evento e entrada autorizada da fila são persistidos na mesma transação. O receptor é um arquivo independente. A fila registra estado, destino, tentativas, último erro e recibo. A escrita concorrente é serializada no SQLite.
- Leituras são autorizadas pelo cenário para **Controle de missão**. Revisões seguem para o mesmo destino se autorizadas no formulário. Check-ins autorizados têm o destino **Apoio de bordo**. Check-ins e revisões desmarcados ficam locais. A auditoria fica local e integra a exportação.
- A fila avança de **Aguardando** para **Enviando**, **Enviado · aguarda confirmação** e **Confirmado**. **Erro** permite nova tentativa; **Conflito** conserva o original para revisão. O receptor usa uma chave única por ID e compara o hash do conteúdo e o destino. O recibo atesta gravação no receptor local. Se o processo parar após a gravação remota e antes de gravar o estado local, o reenvio permite recuperar sem acrescentar uma segunda cópia idêntica.
- `server.py` serve a interface, `GET /api/state`, `GET /api/export` e `POST /api/action`. A exportação filtra pela sessão selecionada. O protótipo usa associação lógica e escuta local, com armazenamento em claro.
- `web/` contém a interface PT-BR e a fotografia local. Tipografia Franklin Gothic Medium para títulos no Windows, Segoe UI para interface e Consolas para telemetria, com alternativas do sistema.

## Escopo e limites

| Estado | Funções |
|---|---|
| Implementado | Dois perfis e históricos, vínculo de dispositivo, sessões e fases, gráfico e tabela com lacunas, inspeção de amostras, check-in, revisão, apoio local, fila persistente, confirmação, deduplicação, conflito, substituição de ID, exportação JSON, roteiro, controles e diário de falhas. |
| Simulado | Tripulantes, dados fisiológicos, dispositivos, enlace, receptor, bateria, perda de sinal, falha de escrita, inspeção de esteira e palmilhas. A carga plantar sintética e os passos ilustrativos usam uma regra de contato ajustável. |
| Conceitual | Cápsula GI além do exemplo térmico, dosimetria, hardware de voo, rádio, ECC, watchdog, redundância, protocolos clínicos, proteção de dados e integração espacial. |
| Fora desta versão | Interface em inglês, módulo nutricional, autenticação e chaves, criptografia em repouso, backup/restauração operacional, integração com sensores e DTN/SDLS. |

ECG e PPG são sinais diferentes. Temperatura da pele, temperatura GI e estimativa térmica têm significados diferentes. A pressão arterial, a pressão venosa e a hidratação exigem métodos específicos e validação. Carga de contato depende do contexto da esteira e da contenção. A cápsula é um conceito de pesquisa com dependências de segurança, retenção e rádio. A dosimetria aritmética é ilustrativa. O protótipo não oferece diagnóstico, ingestão, doses ou tratamento. Os casos de falha são injetados por software. Não há participação de equipe médica, hardware certificado ou sistemas da NASA.

## Testes e decisões

Execute `python -B -m unittest -v` na pasta da aplicação. Os testes iniciam um servidor local em porta livre e usam bancos temporários. Veja [resultados e escopo da verificação](TESTES.md).

1. **P0** — manter o foco em exercício e recuperação. Próxima validação depende de revisão com responsáveis clínicos e estudo de compreensão com usuários.
2. **P1** — definir identidade, autorizações, proteção em repouso, backup e recuperação antes de considerar dados de pessoas. Validar o instrumento térmico e o método contra uma referência apropriada.
3. **P2** — avaliar integração de dispositivos, redes espaciais, mais idiomas e acessibilidade com tecnologias assistivas após definir os requisitos das etapas anteriores.

O demonstrador pode ser executado localmente ou acessado pelo endereço público. Os bancos SQLite da instalação local são criados no primeiro uso. A edição pública mantém sessões próprias por navegador.

## Referências

- Exercício e adaptação em microgravidade. [NASA](https://www.nasa.gov/humans-in-space/counteracting-bone-and-muscle-loss-in-microgravity/)
- Precedentes de monitoramento vestível em voo e sensores de força no calçado. [Agência Espacial Canadense](https://www.asc-csa.gc.ca/eng/sciences/bio-monitor.asp) · [NASA NTRS](https://ntrs.nasa.gov/citations/20060022556)
- Plataformas GI com medições de pesquisa específicas. [FDA · Atmo K250940](https://www.accessdata.fda.gov/cdrh_docs/pdf25/K250940.pdf)
- Limites da medição de pressão arterial em dispositivos sem autorização correspondente. [FDA](https://www.fda.gov/medical-devices/safety-communications/do-not-use-unauthorized-devices-measuring-blood-pressure-fda-safety-communication)
- Armazenamento e encaminhamento em redes intermitentes; protocolo de bundles e sua segurança. [NASA DTN](https://www.nasa.gov/communicating-with-missions/delay-disruption-tolerant-networking/) · [RFC 9171](https://www.rfc-editor.org/rfc/rfc9171.html) · [RFC 9172](https://www.rfc-editor.org/rfc/rfc9172.html)
- Segurança na camada de enlace espacial para quadros definidos. [CCSDS 355.0-B-2](https://ccsds.org/Pubs/355x0b2.pdf)

Fotografia de abertura Earthrise, tirada a bordo da Apollo 8 em 24 de dezembro de 1968. Crédito NASA / Bill Anders. A cópia em WebP acompanha o site para uso offline. [NASA Science](https://science.nasa.gov/resource/apollo-8s-iconic-earthrise/)

