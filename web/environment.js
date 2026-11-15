import {badge,esc,fmt,icon,tag,title} from './ui.js';

const stations={
  lisbon:{name:'Lisboa, Portugal',lat:'38.7223',lon:'-9.1393',bbox:['-9.3200','38.6500','-9.0000','38.8700']},
  berlin:{name:'Berlim, Alemanha',lat:'52.5200',lon:'13.4050',bbox:['13.0800','52.3300','13.7700','52.6900']},
  tunis:{name:'Túnis, Tunísia',lat:'36.8065',lon:'10.1815',bbox:['9.8700','36.6000','10.4400','37.0300']},
  sao:{name:'São Paulo, Brasil',lat:'-23.5505',lon:'-46.6333',bbox:['-46.8300','-23.7900','-46.3500','-23.3500']},
};
const statusNames={
  connected:['Conectado · consulta bem-sucedida','ok'], untested:['Teste real não executado',''],
  offline:['Sem conexão','warn'], denied:['Acesso negado','bad'],
  unconfigured:['Não configurado','warn'], rate_limit:['Limite ou pausa de consultas','warn'],
  empty:['Sem dados para a seleção',''], cache:['Resultado anterior em cache','violet'],
  invalid:['Seleção inválida','bad'], coverage:['Fora da cobertura aproximada','warn'],
  malformed:['Resposta malformada','bad'], service_error:['Erro do serviço','bad'],
  expired:['Acesso temporário expirado','warn'], busy:['Consulta em andamento','violet'],
};
const sourceLinks={
  stac:'https://planetarycomputer.microsoft.com/catalog',
  weather:'https://www.meteomatics.com/en/api/getting-started/',
  euro:'https://www.meteomatics.com/en/weather-model-europe/',
  kp:'https://www.meteomatics.com/en/api/available-parameters/space-weather/',
  donki:'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
};
const selected=(value,current)=>value===current?'selected':'';
const option=(value,current,label)=>`<option value="${esc(value)}" ${selected(value,current)}>${esc(label)}</option>`;
const utcFormatter=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium',timeZone:'UTC'});
const formatDate=(v)=>v?utcFormatter.format(new Date(v))+' UTC':'Não informado';
const display=(v,suffix='')=>v==null?'Não informado':`${esc(typeof v==='number'?fmt(v,4):v)}${suffix}`;
const statusBadge=(state)=>badge(...(statusNames[state]||statusNames.untested));
const source=(url,label)=>url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`:'';
const field=(label,name,value,type='text',more='')=>`<label class="field env-field">${label}<input name="${name}" type="${type}" value="${esc(value)}" required ${more}></label>`;
const select=(label,name,options)=>`<label class="field env-field">${label}<select name="${name}">${options}</select></label>`;
const region=(name,value)=>select(name,'preset',Object.entries(stations).map(([key,place])=>option(key,value,place.name)).join('')+option('custom',value,'Coordenadas manuais'));
const dates=(values)=>`<div class="env-fields">${field('Início (UTC)','start',values.start,'date',`max="${today()}"`)}${field('Fim (UTC)','end',values.end,'date',`max="${today()}"`)}</div>`;
const searchButton=(label,busy)=>`<button class="btn primary" type="submit" ${busy?'disabled':''}>${icon('right')}${busy?'Consultando…':label}</button>`;
const external=(result)=>result?.classification==='external';
const today=(offset=0)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const valuesFor=(station)=>Object.fromEntries(['west','south','east','north'].map((key,i)=>[key,station.bbox[i]]));

export function environmentState(){
  return {
    stac:{collection:'landsat-c2-l2',preset:'lisbon',...valuesFor(stations.lisbon),start:today(-30),end:today()},
    weather:{preset:'lisbon',lat:stations.lisbon.lat,lon:stations.lisbon.lon,model:'mix',horizon:'0'},
    kp:{},donki:{event:'FLR',start:today(-6),end:today()},
    results:{},pending:new Set(),status:null,statusError:false,previews:{},previewPending:null,simulated:false,
  };
}
export function rememberField(state,form,input){
  const kind=form.dataset.env;
  if(!input.name||!Object.hasOwn(state[kind],input.name))return false;
  state[kind][input.name]=input.value;
  if(input.name==='preset'&&stations[input.value]){
    const place=stations[input.value];
    Object.assign(state[kind],kind==='stac'?valuesFor(place):{lat:place.lat,lon:place.lon});
    Object.entries(state[kind]).forEach(([key,value])=>{if(form.elements[key]) form.elements[key].value=value;});
  }else if(['west','south','east','north','lat','lon'].includes(input.name)){
    state[kind].preset='custom';
    form.elements.preset.value='custom';
  }
  return true;
}
export function environmentPayload(state, kind, force){
  const filters=state[kind];
  if(kind==='stac'){
    const {collection,west,south,east,north,start,end}=filters;
    return {collection,bbox:[west,south,east,north],start,end,refresh:force};
  }
  if(kind==='weather'){
    const {lat,lon,model,horizon}=filters;
    return {lat,lon,model,horizon};
  }
  return {...filters};
}
function statusLine(result,busy,emptyText){
  if(busy) return '<p class="note env-note" role="status">Consultando o serviço externo…</p>';
  if(!result) return `<p class="env-muted">${emptyText}</p>`;
  const time=result.fetched_at ? 'Consulta original em '+formatDate(result.fetched_at)+'.' : result.checked_at ? 'Tentativa em '+formatDate(result.checked_at)+'.' : '';
  const age=result.age_seconds==null?'':` Idade do cache ao consultar: ${Math.floor(result.age_seconds/3600)} h ${Math.floor(result.age_seconds%3600/60)} min.`;
  const detail=result.upstream_status ? ` Última tentativa: ${statusNames[result.upstream_status]?.[0]||'indisponível'}. ${result.upstream_message||''}`:'';
  return `<div class="env-note note" role="status"><div class="row">${statusBadge(result.status)}${external(result)?tag('DADO REAL EXTERNO'):''}
  ${result.status==='cache'?tag(result.cache_fresh?'CACHE · DENTRO DO PRAZO':'CACHE · RESULTADO ANTIGO'):''}</div>
  <p class="push">${esc(result.message||'')}${result.retry_after?esc(' Aguarde '+result.retry_after+' s.') : ''} ${esc(time+age+detail)}</p></div>`;
}
const detailsList=(pairs)=>`<dl class="env-details">${pairs.map(([key,v])=>`<div><dt>${key}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

function imagery(state){
  const r=state.results.stac;
  if(!r?.items?.length) return '';
  const items=r.items.map(item=>{
    const preview=state.previews[item.id];
    const busy=state.previewPending===item.id;
    const period=item.start_at&&item.end_at&&item.start_at!==item.end_at
      ?`<span>${formatDate(item.start_at)} — ${formatDate(item.end_at)}</span>`:formatDate(item.acquired_at||item.start_at);
    const action=item.preview?`<button type="button" class="btn" data-action="env-preview" data-value="${esc(item.id)}" ${state.previewPending?'disabled':''}>${busy?'Carregando miniatura…':preview?.url?'Atualizar miniatura':'Ver miniatura'}</button>`:'<span class="muted">Miniatura não informada pela origem</span>';
    return `<details class="env-item" data-env-scene="${esc(item.id)}"><summary><strong>${esc(item.id)}</strong><span>${formatDate(item.acquired_at||item.start_at)}</span></summary>
      <div class="env-item-body">
        ${detailsList([['Aquisição ou composição',period],['Instrumento',display(item.instruments)],['Plataforma',display(item.platform)],
          ['Resolução informada',display(item.resolution_m,' m')],['Nuvens',display(item.cloud_percent,'%')],['Processamento',display(item.processing)],
          ['Produto',display(item.product)],['Limites da cena (°)',display(item.bbox?.join(', '))]])}
        <div class="row">${source(item.link,'Abrir item STAC')}${action}</div>
        ${preview?.url?`<figure class="env-preview"><img alt="Miniatura de observação da Terra da cena ${esc(item.id)}" src="${esc(preview.url)}"><figcaption>Prévia do catálogo · ${esc(r.attribution)}</figcaption></figure>`:''}
        ${preview?.result?statusLine(preview.result,false,''):''}
      </div></details>`;
  }).join('');
  return `<div class="env-result"><div class="env-result-head"><div><h3>${esc(r.collection_name)}</h3><p>${esc(r.attribution)} · acesso via ${esc(r.platform)}</p></div>${tag(r.items.length+' CENAS'+(r.more?'+':''))}</div>
    <p class="env-muted">Área consultada (°): ${esc(r.selection.bbox.join(', '))} · ${esc(r.selection.start)} a ${esc(r.selection.end)} (UTC)
    ${r.nominal_resolution_m?` · Resolução nominal da coleção: ${fmt(r.nominal_resolution_m)} m em grade sinusoidal.`:''}</p>
    <div class="row env-links">${source(r.catalogue,'Coleção no catálogo')}${source(r.documentation,'Documentação do produto')}</div>
    ${items}</div>`;
}
function values(result){
  if(!result?.items?.length) return '';
  const {lat,lon,horizon}=result.selection;
  const place=Object.values(stations).find(city=>Number(city.lat)===lat&&Number(city.lon)===lon)?.name;
  const location=lat==null?'Índice planetário · coordenadas técnicas da API: 0°, 0°':
    `${esc(place||'Ponto terrestre')} (${esc(lat)}°, ${esc(lon)}°) · ${horizon?'+'+esc(horizon)+' h':'janela atual'}`;
  const items=result.items.map(row=>`<div class="env-reading"><div class="env-reading-title"><span>${esc(row.label)}</span><strong>${fmt(row.value,2)} <small>${esc(row.unit)}</small></strong></div>
     <div><div>${formatDate(row.valid_at)} · ${display(row.kind)}</div><small>${esc(row.update)}</small></div></div>`).join('');
  return `<div class="env-result"><h3>${esc(result.attribution)}</h3><p>${location}. Acesso via ${esc(result.platform)}.</p>
    ${detailsList([['Modelo solicitado',display(result.requested_model)],['Modelo informado',display(result.reported_model)],
      ['Horário solicitado',formatDate(result.requested_at)],['Inicialização do modelo',formatDate(result.initialized_at)],
      ['Geração da resposta',formatDate(result.generated_at)]])}
    ${items}${result.missing.length?`<p class="env-muted">Indisponíveis: ${esc(result.missing.join(', '))}.</p>`:''}</div>`;
}
function events(result){
  if(!result||result.status==='empty')return result?.status==='empty'?'<p class="env-muted">Nenhum evento encontrado neste intervalo.</p>':'';
  if(!result.items?.length)return '';
  return `<div class="env-result"><h3>${esc(result.attribution)}</h3><p>Acesso via ${esc(result.platform)} · ${result.items.length} registros${result.more?', exibindo os 30 mais recentes':''}.</p>
    <p>${esc(result.selection.event)} · ${esc(result.selection.start)} a ${esc(result.selection.end)} (UTC).</p>
    ${result.items.map(row=>`<details class="env-item"><summary><strong>${esc(row.type)} · ${esc(row.id)}</strong><span>${formatDate(row.at)}</span></summary>
       <div class="env-item-body">${detailsList([['Início',formatDate(row.at)],['Pico',formatDate(row.peak_at)],['Fim',formatDate(row.ended_at)],
         ['Classe',display(row.class_type)],['Região da fonte',display(row.region)],['Submissão',formatDate(row.submitted_at)]])}
       ${row.note?`<p>${esc(row.note)}</p>`:''}
       ${row.geomagnetic?.length?`<ul>${row.geomagnetic.map(k=>`<li>Kp ${fmt(k.value,2)} · ${formatDate(k.valid_at)} · ${display(k.source)}</li>`).join('')}</ul>`:''}
       ${source(row.link,'Abrir detalhes oficiais')}</div></details>`).join('')}</div>`;
}
function statusCards(state){
  if(state.statusError) return '<p class="note warn">Não foi possível consultar a configuração do servidor local.</p>';
  if(!state.status) return '<p class="env-muted">Verificando a configuração dos conectores…</p>';
  return Object.values(state.status.services).map(item=>`
    <div class="env-status-row"><div><b>${esc(item.name)}</b>${item.status!=='untested'?`<p>${esc(item.message||'')}${item.checked_at?' · '+formatDate(item.checked_at):''}
      ${item.upstream_status?' · '+esc(statusNames[item.upstream_status]?.[0]||'Indisponível'):''}</p>`:''}</div>${statusBadge(item.status)}</div>`).join('');
}
const coord='min="-180" max="180" step="any"';
const lat='min="-90" max="90" step="any"';

export function environmentPanel(e){
  const busy=(key)=>e.pending.has(key);
  const r=e.results;
  const canWeather=e.status?.services.weather.status!=='unconfigured';
  const canKp=e.status?.services.kp.status!=='unconfigured';
  const form=(key,content)=>`<form data-env="${key}">${content}</form>`;
  return `<header class="environment-hero"><div><span class="eyebrow">ASTROHEALTH / CONTEXTO EXTERNO</span><h1>Ambiente da missão</h1>
    <p>Explore imagens da Terra, a meteorologia de um local e os registros públicos de clima espacial.</p>
    <div class="row"><a class="btn" href="#guide">${icon('play')} Abrir cenário de exercício</a>
    <button class="btn ghost" type="button" data-action="env-simulation" aria-expanded="${e.simulated}" aria-controls="env-simulation">${e.simulated?'Ocultar cenário ambiental simulado':'Ver cenário ambiental simulado'}</button></div>
    </div></header>
    <p class="env-origin note">Dados externos descrevem a Terra e o espaço próximo. A telemetria fisiológica e os dispositivos de bordo pertencem à simulação AstroHealth.</p>
    <section class="panel push" id="env-simulation" ${e.simulated?'':'hidden'}>
      ${title('Cenário ambiental simulado','Exemplo offline para a apresentação. Valores fixos em um local terrestre fictício.', 'AMBIENTE SIMULADO')}
      <div class="stats env-sim-stats"><div><b>22,4 °C</b><span>Ar</span></div><div><b>58%</b><span>Umidade</span></div><div><b>3,1 m/s</b><span>Vento</span></div></div>
    </section>
    <div class="two-col env-grid push">
    <section class="panel env-panel">${title('Observação da Terra','Cenas por região e data de aquisição.','PLANETARY COMPUTER')}
      ${form('stac',`<div class="env-fields">${select('Coleção','collection',option('landsat-c2-l2',e.stac.collection,'Landsat C2 · Level-2')+option('modis-09A1-061',e.stac.collection,'MODIS 09A1 · 500 m'))}${region('Região',e.stac.preset)}</div>
      <details class="fold env-bbox"><summary>Editar limites geográficos</summary><div class="env-fields bbox">
      ${field('Oeste (°)','west',e.stac.west,'number',coord)}${field('Sul (°)','south',e.stac.south,'number',lat)}
      ${field('Leste (°)','east',e.stac.east,'number',coord)}${field('Norte (°)','north',e.stac.north,'number',lat)}</div></details>
      ${dates(e.stac)}
      <div class="row">${searchButton('Buscar cenas',busy('stac'))}<button type="submit" class="btn" data-force="true" ${busy('stac')?'disabled':''}>${icon('reset')} Atualizar na fonte</button>
      ${source(sourceLinks.stac,'Catálogo')}</div>`)}
      ${statusLine(r.stac,busy('stac'),'Busca de metadados públicos. A miniatura é carregada sob demanda quando a cena oferece um formato compatível.')}
      ${imagery(e)}
    </section>
    <section class="panel env-panel">${title('Meteorologia terrestre','Condições e previsões para o local selecionado.','METEOMATICS')}
      ${form('weather',`<div class="env-fields">${region('Local',e.weather.preset)}${select('Modelo','model',option('mix',e.weather.model,'Mix · global')+option('mm-euro1k',e.weather.model,'EURO1k · regional'))}
      ${field('Latitude (°)','lat',e.weather.lat,'number',lat)}${field('Longitude (°)','lon',e.weather.lon,'number',coord)}</div>
      ${select('Validade','horizon',option('0',e.weather.horizon,'Janela atual')+option('6',e.weather.horizon,'+6 h')+option('24',e.weather.horizon,'+24 h'))}
      <div class="row">${searchButton('Consultar clima',busy('weather'))}${source(sourceLinks.weather,'Documentação')}${source(sourceLinks.euro,'Cobertura EURO1k')}</div>`)}
      <p class="env-muted">EURO1k é um modelo de previsão regional. O acesso e os parâmetros disponíveis dependem do plano da conta.</p>
      ${statusLine(r.weather||(!canWeather?e.status.services.weather:null),busy('weather'),'O horário de validade pode ser diferente do horário de consulta.')}
      ${values(r.weather)}
    </section>
    <section class="panel env-panel span-all">${title('Clima espacial','Kp descreve perturbação geomagnética terrestre. Um evento solar ou geomagnético, por si só, não determina dose ou exposição individual.','NOAA E NASA')}
      <div class="two-col env-space">
        <div class="env-space-card"><h3>Índice Kp · NOAA</h3><p>Acesso pela Meteomatics. O painel solicita o horário de referência de três horas mais recente.</p>
          ${form('kp',`<div class="row push">${searchButton('Consultar Kp',busy('kp'))}${source(sourceLinks.kp,'Parâmetro kp:idx')}</div>`)}
          ${statusLine(r.kp||(!canKp?e.status.services.kp:null),busy('kp'),'Índice planetário em uma escala de 0 a 9.')}
          ${values(r.kp)}</div>
        <div class="env-space-card"><h3>Eventos · NASA DONKI</h3><p>Rota configurada: ${e.status?.nasa_route==='open-api'?'NASA Open APIs':'serviço público do NASA CCMC'}.</p>
          ${form('donki',`${select('Tipo de evento','event',option('FLR',e.donki.event,'Erupção solar')+option('GST',e.donki.event,'Tempestade geomagnética')+option('CME',e.donki.event,'Ejeção de massa coronal'))}
          ${dates(e.donki)}<div class="row">${searchButton('Buscar eventos',busy('donki'))}${source(sourceLinks.donki,'NASA CCMC')}</div>`)}
          ${statusLine(r.donki||(e.status?.services.donki.status==='unconfigured'?e.status.services.donki:null),busy('donki'),'Registros e análises públicas para o intervalo escolhido.')}
          ${events(r.donki)}</div>
      </div></section>
    <section class="panel span-all">${title('Estado das integrações','Estado da última consulta neste servidor.')}
    ${statusCards(e)}
    <p class="env-muted">Cache local de metadados Landsat ${e.status?.landsat_cache?'ativo':'desativado ou ainda não confirmado'}. O cenário de exercício continua disponível offline.</p></section>
    </div>`;
}

