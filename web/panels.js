import {icon,esc,time,date,fmt,expUrl,initials,button,link,badge,tag,empty,title,delivery,quality,status,table,phases,cap,readings,latest,activeDevices,deviceIcon,linkBadge,context,chart} from './ui.js';
import {environmentPanel} from './environment.js';

export const navigation = [
  ['MISSÃO',[['overview','Visão geral','grid'],['crew','Tripulação e sessões','users'],['health','Telemetria','pulse'],['guide','Demonstração guiada','play'],['environment','Ambiente da missão','orbit']]],
  ['SISTEMAS',[['devices','Dispositivos','box'],['activity','Atividade e palmilhas','activity'],['research','Cápsula e dosimetria','capsule'],['computer','Computador central','layers'],['sync','Comunicação e fila','radio']]],
  ['DOCUMENTAÇÃO',[['lab','Falhas e testes','flask'],['about','Segurança e projeto','shield']]],
];

const metricCards = [
  ['thermal','Térmica estimada','Modelo sintético'],
  ['pulse','Pulso por PPG','Smartwatch · sintético'],
  ['spo2','SpO₂ estimada','Smartwatch · sintético'],
  ['gi','Temperatura GI','Cápsula · sintética'],
];
const pending = s => s.records.filter(r=>r.state && r.state!=='confirmed');
const checks = s => s.records.filter(r=>r.kind==='checkin');
const display = (r) => !r || r.value==null ? 'Indisponível' : fmt(r.value)+' '+r.unit;
const age = (s,r) => Math.max(0,Math.floor((Date.parse(s.server_time)-Date.parse(r.captured_at))/60000));
const noProtocol = '<div class="note warn"><b>Protocolo não disponível.</b> Você pode revisar a sessão e registrar uma observação neste computador. O apoio faz parte do roteiro fictício.</div>';
export const select = (label,action,options,value) => `<label class="row"><span class="sr-only">${label}</span><select aria-label="${label}" data-change="${action}">${options.map(([key,text])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const subhead=(s,label,name,description)=>`<header class="subhead"><div class="eyebrow">${label}</div><h1>${name}</h1><p>${description}</p><div class="row">${context(s)}</div></header>`;
const card=(name,body,sub='',eyebrow='')=>`<section class="panel">${title(name,sub,eyebrow)}${body}</section>`;
const audit=(s,n=8)=>s.audit.length?s.audit.slice(0,n).map(r=>`<div class="event-line"><time datetime="${esc(r.at)}">${time(r.at)}</time><div><b>${esc(r.action)}</b><small>${esc(r.detail)}</small></div></div>`).join(''):empty('Nenhuma atividade registrada.');
const healthMetrics=(s,metric)=>`<div class="metric-grid" role="group" aria-label="Selecionar métrica do gráfico">${metricCards.map(([key,label,source])=>{
  const r=latest(s,key);
  const warning = !r || r.quality!=='usable';
  const old = r && age(s,r)>5;
  const minutes = r ? age(s,r) : 0;
  const recency = minutes<60 ? minutes+' min' : minutes<1440 ? Math.floor(minutes/60)+' h' : Math.floor(minutes/1440)+' d';
  const comment = warning ? (quality[r?.quality]?.[0] || 'Sem amostra') + ' · sintético' : old ? 'Histórica · '+recency : source;
  return `<button type="button" class="metric" data-action="metric" data-value="${key}" aria-pressed="${key===metric}"><span class="metric-label">${label}</span><b class="${r?.value==null?'missing':''}">${r?.value==null?'Indisponível':fmt(r.value)+' <small>'+esc(r.unit)+'</small>'}</b><span class="metric-sub ${warning?'warn':''}">${comment}</span></button>`;
}).join('')}</div>`;
const graph=(s,model,extended=false)=>{
  const {metric,range}=model;
  const tones=[['all','Últimas 36'],['recent','Últimas 8'],...phases.slice(0,3).map(p=>[p,cap(p)])];
  return `<section class="panel chart-panel"><div class="panel-head"><div><h2>${esc(s.metrics[metric][0])}</h2><p>Fase, origem e qualidade de cada amostra.</p></div>${select('Período da curva','range',tones,range)}</div>
    ${extended?`<div class="row push">${select('Métrica da curva','metric',Object.entries(s.metrics).map(([key,value])=>[key,value[0]]),metric)}</div>`:''}${chart(s,metric,range)}</section>`;
};
const ops=(s)=>{
  const a=activeDevices(s), online=a.filter(d=>d.connection==='online').length;
  const items=[
    ['layers','Armazenamento','SQLite de bordo',badge(s.session.storage_fault?'Falha simulada':'Disponível',s.session.storage_fault?'bad':'ok')],
    ['radio','Enlace simulado','Receptor local fictício',badge(s.session.link?'Ativo':'Interrompido',s.session.link?'ok':'warn')],
    ['box','Dispositivos',online+' de '+a.length+' conectados',badge(online===a.length?'Conectados':'Atenção',online===a.length?'ok':'warn')],
    ['clock','Fila de sincronização','Confirmação por recibo',badge(pending(s).length+' pendentes',pending(s).length?'violet':'ok')],
  ];
  return `<section class="panel board-systems">${title('Sistemas de bordo')}<div class="operations">${items.map(([i,name,sub,b])=>`<div class="op-row"><span class="op-icon">${icon(i)}</span><div><b>${name}</b><small>${sub}</small></div>${b}</div>`).join('')}</div>${button('Registrar check-in','checkin',{symbol:'plus',style:'panel-action'})}</section>`;
};
const overview=(s,m)=>`
  <section class="hero"><div class="hero-copy">
    <div class="eyebrow">ASTROHEALTH / COMPUTADOR CENTRAL</div>
    <h1>Controle<br> de missão</h1>
    <p>Telemetria de bordo para uma sessão simulada de exercício e recuperação.</p>
    <div class="hero-buttons">${button(s.session.step===null?'Iniciar demonstração':'Retomar demonstração','begin',{symbol:'play',style:'primary'})}${link('Explorar telemetria','health','right','ghost')}</div>
  </div><figure class="hero-photo"><div class="hero-frame"><img src="/earthrise.webp" alt="A Terra sobre o horizonte lunar, fotografada da Apollo 8"></div><figcaption><span>EARTHRISE · 24 DEZ 1968</span><a href="https://science.nasa.gov/resource/apollo-8s-iconic-earthrise/" target="_blank" rel="noopener noreferrer">NASA / BILL ANDERS ↗</a></figcaption></figure></section>
  <div class="context overview-context"><h2 class="section-title">Telemetria de bordo</h2><div class="session-line"><strong>${esc(s.crew[s.session.astronaut_id].name)} · ${esc(s.session.astronaut_id)}</strong><span>${esc(s.session.id)}</span>${badge(cap(s.session.phase),'violet')}</div></div>
  ${healthMetrics(s,m.metric)}
  <div class="dashboard-grid"><div class="stack">${graph(s,m)}${card('Diário de bordo',audit(s,5))}</div><div class="stack">${ops(s)}${card('Apoio offline',noProtocol + '<div class="row push">'+button('Abrir apoio local','support',{symbol:'book'})+'</div>')}</div></div>`;

const crew=(s)=>subhead(s,'MISSÃO / TRIPULAÇÃO','Tripulação e sessões','Selecione um perfil fictício ou abra uma sessão do seu histórico.')+
  `<div class="two-col">${Object.entries(s.crew).map(([id,p])=>`<button class="panel crew-card" data-action="crew" data-value="${id}" aria-pressed="${id===s.session.astronaut_id}"><span class="avatar">${initials(p.name)}</span><div><strong>${esc(p.name)}</strong><small>${id} · ${esc(p.role)}</small></div>${icon('right')}</button>`).join('')}
  <section class="panel span-all"><div class="panel-head"><div><h2>Histórico do perfil</h2><p>${s.records.length} registros na sessão aberta · ${pending(s).length} pendentes</p></div>${button('Nova sessão','new',{symbol:'plus',style:'primary'})}</div>
    ${table(['Sessão','Atividade','Fase','Início','Término',''],s.history.map(r=>[`<span class="id-text">${esc(r.id)}</span>`,esc(r.activity),badge(cap(r.phase),'violet'),date(r.started),date(r.ended),
    button(r.id===s.session.id?'Aberta':'Abrir','session',{value:r.id,disabled:r.id===s.session.id})]))}</section>
  ${card('Fase atual',`<div class="row">${phases.map(p=>button(cap(p),'phase',{value:p,disabled:p===s.session.phase||s.session.phase==='encerrada'})).join('')}</div>`)}
  ${card('Check-ins',checkins(s)+`<div class="row push">${button('Registrar check-in','checkin',{symbol:'plus'})}</div>`)}
  </div>`;

function checkins(s){
  return checks(s).length?table(['Horário','Estado e observação','Entrega'],checks(s).slice().reverse().map(r=>[
    date(r.captured_at),esc(r.label)+'<small>'+esc(r.text)+'</small>',status(delivery,r.state)])):empty('Nenhum check-in nesta sessão.');
}
const health=(s,m)=>subhead(s,'MISSÃO / TELEMETRIA','Saúde e termorregulação','Curvas sintéticas para explorar origem, contexto e qualidade sem gatilhos clínicos.')+
  healthMetrics(s,m.metric)+`<div class="dashboard-grid"><div class="stack">${graph(s,m,true)}
  ${card('Registros de check-in',checkins(s))}</div><div class="stack">${ops(s)}
  ${card('Coleta sintética',button('Gerar amostras','sample',{symbol:'plus',disabled:s.session.phase==='encerrada'}), 'Inclui os dispositivos associados à sessão.')}</div></div>`;

const guide=(s,m)=>{
  const actual=s.session.step;
  const step=m.guideView??actual;
  const active=actual!==null;
  const playing=m.playing;
  const detail=active?s.guide[step]:s.guide[0];
  const count=(state)=>s.records.filter(r=>r.state===state).length;
  return subhead(s,'MISSÃO / ROTEIRO','Demonstração guiada','Siga o exercício e a recuperação em oito etapas. Cada execução cria uma sessão com histórico próprio.')+
    `<section class="panel guide-current"><div class="eyebrow">${active?'ETAPA '+(step+1)+' / '+s.guide.length:'PREPARAR CENÁRIO'}</div><h2>${detail[0]}</h2><p>${detail[1]}</p>
    ${active&&step<actual?'<p class="push">Revisão de etapa anterior. Os dados exibidos abaixo refletem o estado atual do cenário.</p>':''}
    <div class="row">${active?button('Voltar','guide_back',{symbol:'left',disabled:step===0}):''}
    ${button(active?'Avançar':'Iniciar cenário',active?'guide_next':'guide_start',{symbol:active?'right':'play',style:'primary',disabled:active&&step===s.guide.length-1})}
    ${active?button(playing?'Pausar':'Reproduzir', 'guide_play',{symbol:playing?'pause':'play',disabled:!playing&&step===s.guide.length-1})+' '+button('Reiniciar em nova sessão','guide_start',{symbol:'reset'}):''}</div></section>
    <nav class="steps" aria-label="Etapas da demonstração">${s.guide.map(([name],i)=>button((i+1)+' · '+name,'guide_jump',{value:i,disabled:!active||i>actual,extra:i===step?'aria-current="step"':''})).join('')}</nav>
    <div class="dashboard-grid"><div class="stack">${graph(s,{...m,metric:'thermal'})}${card('Eventos do cenário',audit(s,10))}</div>
    <div class="stack">${card('Camadas da sessão',`<div class="operations">
      <div class="op-row">${icon('pulse')}<b>Sensor torácico</b>${badge(activeDevices(s).find(d=>d.type==='shirt').connection==='online'?'Conectado':'Sem sinal',activeDevices(s).find(d=>d.type==='shirt').connection==='online'?'ok':'warn')}</div>
      <div class="op-row">${icon('radio')}<b>Enlace</b>${linkBadge(s)}</div>
      <div class="op-row">${icon('clock')}<b>Fila local</b>${badge(pending(s).length+' pendentes','violet')}</div>
      <div class="op-row">${icon('check')}<b>Receptor fictício</b>${badge(count('confirmed')+' confirmados','ok')}</div>
    </div><div class="row push">${link('Inspecionar AHCC','computer','layers')}${link('Abrir fila','sync','radio')}</div>`)}
    ${card('Check-in e apoio',noProtocol+'<div class="push">'+checkins(s)+'</div><div class="row push">'+button('Abrir apoio local','support',{symbol:'book'})+'</div>')}</div></div>`;
};

const devices=s=>subhead(s,'SISTEMAS / DISPOSITIVOS','Dispositivos e sensores','Controle o estado de cada dispositivo fictício e rastreie a sua chegada ao AHCC.')+
  `<div class="three-col">${s.devices.map(d=>{
    const info=s.device_info[d.type], revoked=d.connection==='revoked';
    const deviceReadings=Object.entries(s.metrics).filter(([,v])=>v[4]===d.type).map(([k,v])=>{
      const r=readings(s,k).findLast(x=>x.device_id===d.id&&x.quality!=='out_of_order');
      return `<span title="${esc(v[0])}">${esc(v[0])} · ${esc(display(r))}</span>`;
    });
    return `<article class="panel device-card"><div class="panel-head"><div class="section-title">${icon(deviceIcon(d.type))}<h2>${info.label}</h2></div>${badge(revoked?'Revogado':d.connection==='online'?'Conectado':'Desconectado',revoked?'bad':d.connection==='online'?'ok':'warn')}</div>
    <div class="id-text">${esc(d.id)}</div><div class="row between"><span class="muted">Bateria simulada</span><b>${d.battery}%</b></div><div class="battery ${d.battery<20?'low':''}" aria-hidden="true"><span style="width:${d.battery}%"></span></div>
    <p>${esc(info.description)}</p><div class="row push">${deviceReadings.map(tag).join('')}</div>
    <details class="inline-details"><summary>Fluxo e controles</summary><p>Rádio simulado → gateway → validação de sessão → SQLite do AHCC.</p>
    <div class="row push">${['offline','online','battery','stale','replace'].map((op,i)=>button(['Desconectar','Reconectar','Bateria baixa','Envelhecer leitura','Substituir'][i],'device',{value:d.id,disabled:revoked||s.session.phase==='encerrada',extra:'data-mode="'+op+'"'})).join('')}</div></details></article>`;
  }).join('')}</div><div class="note push">ECG e PPG têm métodos distintos. Pressão arterial, pressão venosa e hidratação exigem instrumentação e validação próprias.</div>`;

const activity=(s,m)=>{
  const left=latest(s,'left_force'),right=latest(s,'right_force'),belt=latest(s,'belt');
  const mode=m.activity;
  const limit=m.threshold;
  const paired=left?.value!=null&&right?.value!=null&&![left.quality,right.quality].includes('stale');
  const contact=paired&&left.value>=limit&&right.value>=limit;
  const stepsLeft=latest(s,'left_steps')?.value,stepsRight=latest(s,'right_steps')?.value;
  const steps=mode==='treadmill'&&contact&&stepsLeft!=null&&stepsRight!=null?stepsLeft+stepsRight:null;
  const estimate=steps==null?null:Math.round(steps*.68);
  const difference=estimate!=null&&belt?.value!=null?estimate-belt.value:null;
  return subhead(s,'SISTEMAS / ATIVIDADE','Esteira e palmilhas','Explore carga de contato, perda de sinal por lado e diferenças entre fontes.')+
    `<div class="two-col">${[['left','Palmilha esquerda',left],['right','Palmilha direita',right]].map(([key,label,r])=>{
      const id=activeDevices(s).find(d=>d.type===key).id;
      return card(label,`<div class="row">${r?status(quality,r.quality):badge('Indisponível','warn')}<strong>${esc(display(r))}</strong></div>
      <div class="row push">${button('Desconectar','device',{value:id,extra:'data-mode="offline"',disabled:s.session.phase==='encerrada'})}
      ${button('Reconectar','device',{value:id,extra:'data-mode="online"',disabled:s.session.phase==='encerrada'})}</div>`,'Carga de contato sintética · newtons');
    }).join('')}
    <section class="panel span-all">${title('Comparar telemetria','Regra artificial de contato, ajustável apenas para a demonstração.')}
    <div class="row">${select('Modo de atividade','activity',[['treadmill','Esteira com contenção'],['float','Movimento sem contato']],mode)}
    <label class="row">Contato mínimo demonstrativo <input type="number" min="0" max="500" step="5" value="${limit}" data-change="threshold" aria-label="Limiar de contato em newtons"> N</label></div>
    <div class="numbers push">${[['Esteira simulada',display(belt)],['Palmilhas · estimativa',estimate==null?'—':estimate+' m'],['Diferença entre fontes',difference==null?'—':difference+' m'],['Confiança',!paired?'Reduzida':contact&&mode==='treadmill'?'Comparável':'Indefinida']].map(([label,value])=>`<div class="number"><b>${esc(value)}</b><small>${label}</small></div>`).join('')}</div>
    <p>${!paired?'A comparação precisa de amostras dos dois lados.':mode==='float'?'Movimento sem contato. A contagem fica indisponível.':!contact?'Contato abaixo do limiar artificial. A contagem fica indisponível.':'A estimativa soma os passos sintéticos das duas palmilhas e multiplica por uma passada ilustrativa de 0,68 m. A distância da esteira vem de uma série sintética independente.'}</p></section></div>`;
};

const research=(s,m)=>subhead(s,'SISTEMAS / PESQUISA','Cápsula e dosimetria','Explore conceitos de instrumentação e os limites de cada demonstração.')+
  `<div class="two-col">${card('Cápsula gastrointestinal',`<div class="row">${badge('Conceito de pesquisa','violet')}${badge('Temperatura sintética','ok')}</div><div class="push">${chart(s,'gi','recent')}</div>
  <details class="fold push"><summary>Outras métricas e limites</summary><p>pH local, pressão ou motilidade, gases, trânsito e estimativa de região estão indisponíveis. Esses recursos dependem da plataforma. Gases locais descrevem o meio gastrointestinal. Temperatura gastrointestinal é uma grandeza local. Estudos próprios precisam avaliar retenção, biocompatibilidade e rádio.</p></details>`)}
  ${card('Dosimetria',`<div class="row">${badge('Conceitual','violet')}${select('Intervalo da amostra','dose',[['1','1 min'],['5','5 min'],['15','15 min']],m.dose)}</div>
  <p class="push">Amostra fictícia de dose absorvida: <b>${fmt(0.004*Number(m.dose),3)} µGy</b> em ${m.dose} min.</p><p>Incerteza instrumental indisponível. Exemplo aritmético sem instrumento ou calibração; horário da seleção: ${time(s.server_time)}.</p><p>Ambiente de radiação, tipo de partícula e interações com materiais influenciam a dosimetria e a escolha da blindagem.</p>`)}</div>`;

const blocks=[
 ['Dispositivos','box','Simulado','As fontes fictícias geram pacotes versionados com ID, amostra, unidade e captura.','A transmissão de hardware é representada pelo gerador local.'],
 ['Gateway','radio','Simulado','Recebe pacotes dos dispositivos e encaminha à associação.','O rádio é uma representação do cenário; a aplicação roda no mesmo computador.'],
 ['Validação e vínculo','shield','Implementado','Confere o tipo de sinal, a unidade, o relógio, a origem sintética e a sessão à qual o dispositivo pertence.','Rejeições ficam no diário. As credenciais de dispositivos permanecem conceituais.'],
 ['Armazenamento','box','Implementado','SQLite persiste evento, metadados e entrada autorizada da fila em uma transação.','Restauração, redundância, backups operacionais e ECC permanecem conceituais.'],
 ['Fila','layers','Implementado','Mantém o estado, a tentativa, o destino, o erro e o recibo de cada registro.','A sincronização é acionada pela demonstração ou no painel de comunicação.'],
 ['Enlace da nave','link','Simulado','A chave do cenário permite ou interrompe a entrega à outra base local.','SDLS, redes da NASA e Bundle Protocol permanecem fora do demonstrador.'],
 ['Receptor local','check','Simulado','O segundo SQLite registra os IDs recebidos e compara o conteúdo em retransmissões.','A confirmação identifica uma gravação no receptor fictício.'],
];
const computer=(s,m)=>subhead(s,'SISTEMAS / AHCC','Computador central','Siga o fluxo de um evento desde o dispositivo até a confirmação.')+
  `<section class="panel">${title('Fluxo do evento','Selecione um componente para inspecionar a camada.')}
    <div class="flow">${blocks.map(([label,i],at)=>button(label,'flow',{symbol:i,value:at,extra:'aria-pressed="'+(m.flow===at)+'"'})).join('')}</div>
    <div class="note"><div class="row">${badge(blocks[m.flow][2],'violet')}<b>${blocks[m.flow][0]}</b></div><p class="push">${blocks[m.flow][3]}</p><p>${blocks[m.flow][4]}</p></div>
  </section><div class="two-col push">${card('Estado operacional',audit(s,7))}${card('Engenharia futura','<p>Monitoramento de energia e temperatura, watchdog, módulos substituíveis em hardware, backups e interfaces da nave exigem especificação e ensaios. A substituição do ID do dispositivo pode ser simulada no painel de dispositivos.</p><div class="row push">'+link('Abrir dispositivos','devices','box')+'</div>')}</div>`;

const sync=(s,m)=>{
  const queued=s.records.filter(r=>r.state);
  const filtered=queued.filter(r=>(m.queue==='all'||r.state===m.queue)&&(m.queueKind==='all'||r.kind===m.queueKind)).reverse();
  const kinds={reading:'Leitura',checkin:'Check-in',review:'Revisão'};
  return subhead(s,'SISTEMAS / COMUNICAÇÃO','Comunicação e fila','Acompanhe a escrita local, a transmissão simulada e o recibo do receptor fictício.')+
  `<div class="numbers">${[['Aguardando',['waiting','sending']],['Enviados sem confirmação',['sent']],['Confirmados',['confirmed']],['Erros e conflitos',['error','conflict']]].map(([label,states])=>`<div class="number"><b>${queued.filter(r=>states.includes(r.state)).length}</b><small>${label}</small></div>`).join('')}</div>
  <section class="panel"><div class="panel-head"><div><h2>Operar o enlace</h2><p>Leituras e revisões autorizadas vão para Controle de missão. Check-ins autorizados vão para Apoio de bordo.</p></div>${linkBadge(s)}</div>
  <div class="row">${button(s.session.link?'Interromper enlace':'Religar enlace','link',{symbol:'radio'})}
    ${button('Preparar envio','sync',{value:'prepare',disabled:!s.session.link})}
    ${button('Enviar pendentes','sync',{symbol:'right',value:'send',style:'primary',disabled:!s.session.link})}
    ${button('Consultar confirmação','sync',{symbol:'check',value:'ack',disabled:!s.session.link})}
    ${button('Simular confirmação perdida','sync',{value:'lose_ack',disabled:!s.session.link})}
    <a href="${expUrl(s)}" class="btn" download>${icon('download')} Exportar JSON</a></div></section>
  <section class="panel push"><div class="panel-head"><div><h2>Registros enfileirados</h2><p>${filtered.length} registros no filtro.</p></div><div class="row">
  ${select('Filtrar estado de entrega','queue',[['all','Todos os estados'],...Object.entries(delivery).map(([k,v])=>[k,v[0]])],m.queue)}
  ${select('Filtrar tipo de registro','queueKind',[['all','Todos os tipos'],...Object.entries(kinds)],m.queueKind)}</div></div>
  ${table(['Registro','Destino simulado','Criação','Estado','Tentativas','Recibo'],filtered.map(r=>[
    esc(kinds[r.kind])+`<small class="id-text">${esc(r.event_id)}</small>`,esc(r.receiver),time(r.created),status(delivery,r.state)+(r.last_error?`<small>${esc(r.last_error)}</small>`:''),
    String(r.attempts),r.ack_at?date(r.ack_at):'—']))}</section>
  <section class="panel push"><div class="panel-head"><div><h2>Revisão técnica</h2><p>Escolha se o registro fictício entra na fila de Controle de missão.</p></div>${button('Registrar revisão','review',{symbol:'plus'})}</div></section>`;
};
const lab=(s,m)=>{
  const device=activeDevices(s).find(d=>d.type==='shirt');
  const active=s.session.phase!=='encerrada';
  const scenarios=[
    ['Sensor desconectado','T01','Uma lacuna e uma amostra nula na série térmica.', 'device',device.id,'offline'],
    ['Bateria baixa','LAB','Bateria a 12% e qualidade sinalizada.', 'device',device.id,'battery'],
    ['Unidade incompatível','T02','Rejeição com motivo no diário.', 'fail','unit'],
    ['Horário inválido','T03','Rejeição de tempo sem fuso válido.', 'fail','clock'],
    ['Vínculo cruzado','T05','Dispositivo fora da sessão é rejeitado.', 'fail','profile'],
    ['Dispositivo desconhecido','LAB','Dispositivo sem vínculo é rejeitado.', 'fail','unknown'],
    ['Amostra atrasada','LAB','A captura anterior fica marcada como fora de ordem.', 'fail','order'],
    ['Interrupção durante envio','T06','O envio para, registros ficam preservados.', 'sync','interrupt'],
    ['Confirmação perdida','T07','O receptor grava e a fila espera confirmação.', 'sync','lose_ack'],
    ['Duplicata','T07','O ID idêntico é registrado sem nova leitura.', 'fail','duplicate'],
    ['Conflito de ID','T08','O conteúdo original da leitura fica preservado.', 'fail','conflict'],
    ['Conflito no receptor','T08','O primeiro pendente recebe uma divergência; consulte o recibo para vê-la.', 'sync','remote_conflict'],
    ['Falha de armazenamento','T10',s.session.storage_fault?'Restaura a escrita local.':'Bloqueia novos registros. Tente um check-in para verificar.', 'storage',''],
    ['Leitura antiga','LAB','A leitura antiga fica marcada como desatualizada.', 'device',device.id,'stale'],
    ['Palmilha esquerda','T15','O lado esquerdo fica indisponível.', 'device',activeDevices(s).find(d=>d.type==='left').id,'offline'],
  ];
  return subhead(s,'DOCUMENTAÇÃO / CONFIABILIDADE','Laboratório de falhas','Injete condições controladas no cenário atual e confira o resultado observado no diário.')+
    `<div class="two-col"><section class="panel">${title('Cenários interativos','Os identificadores T01–T15 correspondem ao conjunto de testes do projeto.')}
    ${scenarios.map(([name,id,detail,op,value,mode])=>`<div class="op-row"><span class="eyebrow">${id}</span><div><b>${name}</b><small>${detail}</small></div>
     ${button(op==='storage'&&s.session.storage_fault?'Restaurar':'Executar',op,{value,disabled:op==='device'&&!active||op==='sync'&&!s.session.link,extra:mode?'data-mode="'+mode+'"':''})}</div>`).join('')}</section>
     <div class="stack">${card('Resultado observado',(m.labResult?`<div class="note ${m.labResult.ok?'':'warn'}" role="status">${esc(m.labResult.message)}</div>`:'')+audit(s,18),'Eventos e erros retornados pelo backend.')}
     ${card('Continuidade',`<div class="row">${button(s.session.link?'Interromper enlace':'Religar enlace','link',{symbol:'radio'})}${link('Abrir sincronização','sync','right')}${link('Operar dispositivos','devices','right')}</div>`)}</div></div>`;
};

const about=(s)=>subhead(s,'DOCUMENTAÇÃO / PROJETO','Segurança e projeto','AstroHealth é um protótipo educacional para demonstrar observação de exercício e recuperação com dados fictícios.')+
  `<div class="two-col">
  ${card('O que está em uso',`<div class="stack"><div>${badge('Implementado','ok')}<p>Associação lógica no servidor, validação, persistência SQLite, apoio local, fila, exportação e confirmação após recibo.</p></div>
  <div>${badge('Simulado','violet')}<p>Tripulação, medições, dispositivos, interrupções, armazenamento defeituoso e receptor em banco separado.</p></div>
  <div>${badge('Conceitual','warn')}<p>Hardware, instrumentos de voo, comunicação espacial, segurança operacional e protocolos médicos aprovados.</p></div></div>`)}
  ${card('Segurança em camadas',`<details class="fold" open><summary>Identidade e autorização</summary><p>O protótipo valida a associação dos IDs à sessão e possui um mapa fictício de destinos. Autenticação mútua, credenciais, permissões reais e revogação criptográfica são propostas futuras.</p></details>
  <details class="fold"><summary>Criptografia de aplicação</summary><p>Cifra protege confidencialidade. Assinatura ajuda a verificar origem e integridade. Um esquema híbrido protege uma chave de sessão com criptografia assimétrica e cifra dados com autenticação. O banco local é acessível em claro ao usuário do sistema.</p></details>
  <details class="fold"><summary>CCSDS, SDLS e DTN</summary><p>O CCSDS publica padrões espaciais. SDLS protege determinados quadros de enlace. DTN usa armazenamento e encaminhamento para redes intermitentes. Proteção de enlace, segurança de bundles e proteção de aplicação operam em camadas próprias. Neste site essas tecnologias são conceituais.</p></details>
  <details class="fold"><summary>ECC e tolerância a falhas</summary><p>ECC de memória lida com classes específicas de erro de memória. Correção no enlace, autenticação criptográfica e backups resolvem problemas diferentes. O hash da demonstração compara conteúdo; ele não autentica a origem.</p></details>`)}
  ${card('Limites científicos',`<p>As faixas usadas pelo programa são regras instrumentais artificiais. A série térmica estimada, a temperatura da pele e a temperatura gastrointestinal têm significados distintos. O material educacional não define diagnóstico, tratamento, ingestão ou suplementação.</p><div class="push">${noProtocol}</div><div class="row push">${button('Ver resumo para apresentação','pitch',{symbol:'play'})}</div>`)}
  ${card('Referências primárias',`<ul><li>Armazenamento e encaminhamento em redes intermitentes. <a href="https://www.nasa.gov/communicating-with-missions/delay-disruption-tolerant-networking/" target="_blank" rel="noopener">NASA DTN</a></li>
  <li>Protocolo de bundles e segurança de bundles. <a href="https://www.rfc-editor.org/rfc/rfc9171.html" target="_blank" rel="noopener">RFC 9171</a> · <a href="https://www.rfc-editor.org/rfc/rfc9172.html" target="_blank" rel="noopener">RFC 9172</a></li>
  <li>Instrumentação e carga no calçado em exercício. <a href="https://ntrs.nasa.gov/citations/20060022556" target="_blank" rel="noopener">NASA NTRS</a></li>
  <li>Exemplos de plataformas de cápsulas distintas. <a href="https://www.accessdata.fda.gov/cdrh_docs/pdf5/K053547.pdf" target="_blank" rel="noopener">SmartPill</a> · <a href="https://www.accessdata.fda.gov/cdrh_docs/pdf25/K250940.pdf" target="_blank" rel="noopener">Atmo</a></li></ul>`)}
  </div>`;

export const panels={overview,crew,health,guide,devices,activity,research,computer,sync,lab,about,
  environment:(_state,model)=>environmentPanel(model.environment)};
export const supportHtml=noProtocol;

