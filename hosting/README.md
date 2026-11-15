# AstroHealth público

Edição pública do demonstrador AstroHealth v0.5.1. As sessões, tripulantes e leituras fisiológicas são fictícios. Use somente observações fictícias. O visitante tem um histórico separado pelo cookie do navegador, com até oito sessões e retenção por 30 dias a partir da última gravação. A aplicação local em Python mantém os próprios registros.

- Use Node.js 24 ou superior. Na pasta `hosting`, `npm run build` reúne o Worker, a interface em `../web` e a foto creditada em `dist/server/index.js`.
- `npm test` monta e exercita o Worker com SQLite local e respostas externas simuladas.
- Para hospedar, aplique as migrações de `drizzle/` a um banco D1 e exponha-o ao Worker com o binding `DB`. Em um deploy pelo Sites, o manifesto local `.openai/hosting.json` segue o modelo `hosting.example.json` e recebe o ID do projeto da sua conta.
- O Worker usa D1. A missão e os recibos do receptor fictício são persistidos por revisão, com isolamento entre navegadores.
- STAC e o endpoint público NASA CCMC são consultados ao clicar nos controles. Meteomatics e índice Kp exigem `METEOMATICS_USERNAME` e `METEOMATICS_PASSWORD` na hospedagem.
- A interrupção de enlace é parte do roteiro. O demonstrador público é acessado pela internet.
- Earthrise, NASA / Bill Anders. [Crédito e registro de origem](https://science.nasa.gov/resource/apollo-8s-iconic-earthrise/)

