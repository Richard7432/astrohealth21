import {icon,esc,time,date,fmt,initials,button,badge,tag,quality,status,cap} from './ui.js';
import {navigation,panels,supportHtml} from './panels.js';
import {environmentState,environmentPayload,rememberField} from './environment.js';

const $ = (selector) => document.querySelector(selector);
const view=$('#view'), dialog=$('#dialog'), toast=$('#toast'), crewSelect=$('#crew');
const names=Object.fromEntries(navigation.flatMap(([,items])=>items.map(([id,name])=>[id,name])));
const sessionByCrew={};
const model={
  crew:'A12', page:'overview', metric:'thermal', range:'all', flow:0, queue:'all',queueKind:'all',
  activity:'treadmill',threshold:120,dose:'5',guideView:null,playing:false,labResult:null,
  state:null,busy:false,environment:environmentState(),
};
let request=0, toastTimer, playTimer, environmentStatusRequest=0;
let dialogOwner=null;
$('#menu').innerHTML=icon('menu');

function announce(message, failure=false){
  clearTimeout(toastTimer);
  toast.textContent=message;
  toast.className=failure?'error':'';
  toastTimer=setTimeout(()=>{toast.textContent='';},6500);
}
function closeMenu(){
  $('#rail').classList.remove('open');
  $('#menu').setAttribute('aria-expanded','false');
}

function render(preserve=true){
  const previous=document.activeElement;
  const details=preserve?[...view.querySelectorAll('details')].map(el=>el.open):[];
  const action=preserve&&view.contains(previous)?previous.dataset.action:null;
  const change=preserve&&view.contains(previous)?previous.dataset.change:null;
  const value=previous?.dataset.value, mode=previous?.dataset.mode;
  $('#page-label').textContent=names[model.page];
  $('#telemetry-badge').textContent=model.page==='environment'?'TELEMETRIA SINTÉTICA':'DADOS SINTÉTICOS';
  $('#navigation').innerHTML=navigation.map(([group,items])=>
    `<div class="rail-group"><div class="rail-label">${group}</div>${items.map(([id,label,symbol])=>
       `<a class="nav-link" href="#${id}" ${id===model.page?'aria-current="page"':''}>${icon(symbol)}${label}</a>`).join('')}</div>`).join('');
  if (!model.state&&model.page!=='environment') {
    view.setAttribute('aria-busy','true');
    view.innerHTML='<p class="panel loading">Carregando a sessão…</p>';
    return;
  }
  view.setAttribute('aria-busy','false');
  const state=model.state;
  crewSelect.value=model.crew;
  if(state) $('#top-avatar').textContent=initials(state.crew[model.crew].name);
  view.innerHTML=panels[model.page](state,model);
  view.querySelectorAll('details').forEach((el,i)=>{if(i in details) el.open=details[i];});
  if (!dialog.open && action) {
    const candidate=[...view.querySelectorAll('[data-action]')].find(el=>el.dataset.action===action&&el.dataset.value===value&&el.dataset.mode===mode);
    candidate?.focus({preventScroll:true});
  }
  if (!dialog.open && change) view.querySelector(`[data-change="${change}"]`)?.focus({preventScroll:true});
}

async function refresh(clear=false){
  const serial=++request;
  const crew=model.crew;
  const sid=sessionByCrew[crew];
  if (clear){
    model.state=null;
    render(false);
  }
  try {
    const query=new URLSearchParams({crew});
    if (sid) query.set('session',sid);
    const response=await fetch('/api/state?'+query);
    const data=await response.json();
    if(serial!==request) return false;
    if(!response.ok) throw Error(data.error||'Falha de leitura da sessão.');
    model.state=data;
    render(!clear);
    return true;
  } catch(error) {
    if(serial!==request) return false;
    if(model.page==='environment') {render();return false;}
    view.setAttribute('aria-busy','false');
    view.innerHTML=`<section class="panel"><h2>Não foi possível carregar a sessão</h2><p>${esc(error.message)}</p><div class="row push">${button('Tentar novamente','retry',{style:'primary'})}</div></section>`;
    return false;
  }
}
async function operation(op, details={}){
  if (model.busy || !model.state) return null;
  const {astronaut_id:crew,id:sid}=model.state.session;
  const recordedPage=model.page;
  model.busy=true;
  document.body.dataset.busy='true';
  try {
    const response=await fetch('/api/action',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({crew,session_id:sid,op,...details}),
    });
    const data=await response.json();
    const message=data.message||data.error||'Resposta indisponível.';
    if(recordedPage==='lab'&&model.crew===crew) model.labResult={message,ok:response.ok};
    if(response.ok && (op==='new'||op==='guide_start')) sessionByCrew[crew]=data.session_id;
    if(model.crew===crew) await refresh();
    if(!response.ok || op!=='guide_next') announce(message,!response.ok);
    return response.ok?data:null;
  } catch(error) {
    announce(error.message||'Não foi possível alcançar o servidor local.',true);
    return null;
  } finally {
    model.busy=false;
    document.body.dataset.busy='false';
  }
}

function route(focus=true){
  const routeId=location.hash.slice(1);
  if(routeId==='view') return;
  const next=Object.hasOwn(panels,routeId)?routeId:'overview';
  if(next!=='guide') pause(false);
  model.page=next;
  if(next!=='lab') model.labResult=null;
  closeMenu();
  render(false);
  if(next==='environment') refreshEnvironmentStatus();
  window.scrollTo(0,0);
  if(focus) view.focus({preventScroll:true});
}
function navigate(page){
  if(location.hash==='#'+page){model.page=page;render(false);return;}
  location.hash=page;
}
async function selectCrew(value){
  if(value===model.crew) return;
  pause(false);
  crewSelect.value=value;
  model.crew=value;
  model.guideView=null;
  model.labResult=null;
  dialog.close();
  await refresh(true);
}
function pause(redraw=true){
  clearTimeout(playTimer);
  model.playing=false;
  if(redraw&&model.state) render();
}
async function guideNext(){
  const current=model.state?.session.step;
  if (current==null) return false;
  if (model.guideView!=null && model.guideView<current){
    model.guideView++;
    render();
    return true;
  }
  model.guideView=null;
  return Boolean(await operation('guide_next',{expected_step:current}));
}
function schedule(){
  clearTimeout(playTimer);
  if(!model.playing) return;
  playTimer=setTimeout(async ()=>{
    if(!model.playing||model.page!=='guide') return;
    if(model.busy){schedule();return;}
    const progressed=await guideNext();
    const end=model.state?.guide.length-1;
    if(!progressed||(model.guideView??model.state?.session.step)>=end){pause();return;}
    schedule();
  },2200);
}
async function startGuide(){
  const crew=model.crew;
  pause(false);
  model.guideView=null;
  if(await operation('guide_start') && crew===model.crew) navigate('guide');
}
function popup(title, body){
  dialogOwner=document.activeElement;
  dialog.innerHTML=`<div class="row between"><span class="eyebrow">ASTROHEALTH / SESSÃO LOCAL</span><button type="button" class="icon-btn" data-action="close" aria-label="Fechar janela">${icon('close')}</button></div><h2 id="dialog-title">${title}</h2>${body}`;
  if(!dialog.open) dialog.showModal();
}
function recordForm(kind){
  const isCheck=kind==='checkin';
  popup(isCheck?'Registrar check-in':'Registrar revisão técnica',`<p>Use apenas uma observação fictícia associada à sessão atual.</p>
    <form data-form="${kind}">
    ${isCheck?`<label class="field">Estado relatado<select name="label"><option>Dentro do esperado</option><option>Quero revisar a sessão</option></select></label>`:''}
    <label class="field">Observação sintética<textarea name="text" maxlength="240" rows="3" placeholder="Observação sobre o cenário"></textarea></label>
    <label class="check"><input type="checkbox" name="authorized" checked><span>Autorizar envio simulado para ${isCheck?'Apoio de bordo':'Controle de missão'}.</span></label>
    <p class="form-result" role="status"></p><div class="row form-actions"><button class="btn primary" type="submit">${icon('check')} Salvar localmente</button></div>
    <details class="inline-details"><summary>Apoio offline</summary>${supportHtml}</details></form>`);
}
function inspect(id){
  const r=model.state.records.find(item=>item.event_id===id);
  if(!r) return;
  const age=Math.max(0,Math.floor((Date.parse(model.state.server_time)-Date.parse(r.captured_at))/1000));
  const ageText=age<60?age+' s':Math.floor(age/60)+' min';
  const detail=[
    ['Valor',r.value==null?'Indisponível':fmt(r.value)+' '+r.unit],
    ['Qualidade',r.quality_reason],
    ['Origem','Sintética · '+(r.estimated?'estimada':'amostra gerada')],
    ['Método',r.method],
    ['Identificador',r.event_id],
    ['Dispositivo',r.device_id],
    ['Captura',date(r.captured_at)+' · '+time(r.captured_at)],
    ['Recebimento',date(r.received_at)+' · '+time(r.received_at)],
    ['Idade no carregamento',ageText],
    ['Fase da amostra',cap(r.phase)],
    ['Calibração',r.calibration],
    ['Esquema e sequência','v'+r.schema_version+' · '+r.sequence],
  ];
  popup(esc(model.state.metrics[r.metric_code][0]),`<div class="row">${status(quality,r.quality)}${tag(r.astronaut_id)}${tag(r.session_id)}</div><dl class="reading-detail">${detail.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`);
}

const actions={
  retry:()=>{delete sessionByCrew[model.crew];return refresh(true);},
  begin:()=>model.state.session.step===null?startGuide():navigate('guide'),
  guide_start:startGuide,
  guide_next:guideNext,
  guide_back:()=>{pause(false);model.guideView=Math.max(0,(model.guideView??model.state.session.step)-1);render();},
  guide_jump:(i)=>{pause(false);model.guideView=Number(i);render();},
  guide_play:()=>{if(model.playing){pause();return;}model.playing=true;render();schedule();},
  metric:(value)=>{model.metric=value;model.range='all';render();},
  flow:(value)=>{model.flow=Number(value);render();},
  crew:selectCrew,
  session:(value)=>{pause(false);sessionByCrew[model.crew]=value;model.guideView=null;return refresh(true);},
  phase:(phase)=>operation('phase',{phase}),
  sample:()=>operation('sample'),
  link:()=>operation('link'),
  storage:()=>operation('storage'),
  sync:(mode)=>operation('sync',{mode}),
  fail:(mode)=>operation('fail',{mode}),
  device:(device,mode)=>operation('device',{device,mode}),
  checkin:()=>recordForm('checkin'),
  review:()=>recordForm('review'),
  support:()=>popup('Apoio offline',supportHtml+'<p class="push">No cenário, a revisão humana seria responsabilidade da equipe da missão. O software exibe apenas os registros fictícios disponíveis neste computador.</p>'),
  pitch:()=>popup('Apresentação rápida','<p>O AstroHealth demonstra como uma tripulação fictícia acompanha a resposta térmica durante exercício, identifica uma lacuna, registra um check-in e preserva os dados quando o enlace cai. Ao reconectar, o AHCC confirma apenas os registros verificados no receptor local simulado.</p><div class="row push">'+button('Iniciar cenário','guide_start',{symbol:'play',style:'primary'})+'</div>'),
  new:()=>popup('Nova sessão',`<p>Escolha a atividade fictícia. O histórico deste perfil continua disponível.</p><form data-form="new"><label class="field">Atividade<select name="activity"><option>Esteira orbital</option><option>Cicloergômetro</option><option>Treino resistido</option></select></label><button class="btn primary" type="submit">Criar sessão</button></form>`),
  close:()=>dialog.close(),
  reading:inspect,
  'env-simulation':()=>{model.environment.simulated=!model.environment.simulated;render();},
  'env-preview':showPreview,
};

function renderEnvironment(){
  if(model.page==='environment') render();
}
async function refreshEnvironmentStatus(){
  const serial=++environmentStatusRequest;
  const module=model.environment;
  try{
    const response=await fetch('/api/environment/status');
    if(!response.ok) throw Error();
    const status=await response.json();
    if(serial===environmentStatusRequest){module.status=status;module.statusError=false;}
  }catch{
    if(serial===environmentStatusRequest){module.status=null;module.statusError=true;}
  }
  if(serial===environmentStatusRequest) renderEnvironment();
}
function environmentRequest(kind,payload){
  return fetch('/api/environment/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)});
}
function clearPreviews(module){
  Object.values(module.previews).forEach(preview=>{if(preview.url) URL.revokeObjectURL(preview.url);});
  module.previews={};
}
async function searchEnvironment(kind,force){
  const module=model.environment;
  if(module.pending.has(kind)) return;
  const payload=environmentPayload(module,kind,force);
  module.pending.add(kind);
  renderEnvironment();
  try{
    const result=await (await environmentRequest(kind,payload)).json();
    if(kind==='stac') clearPreviews(module);
    module.results[kind]=result.status?result:{status:'invalid',message:result.error};
  }catch{
    if(kind==='stac') clearPreviews(module);
    module.results[kind]={status:'offline',message:'O servidor local ficou indisponível durante a consulta.'};
  }finally{
    module.pending.delete(kind);
    renderEnvironment();
    refreshEnvironmentStatus();
  }
}
async function showPreview(item){
  const module=model.environment;
  const selected=module.results.stac;
  if(module.previewPending || !selected?.items?.some(record=>record.id===item&&record.preview)) return;
  module.previewPending=item;
  renderEnvironment();
  let preview;
  try{
    const response=await environmentRequest('preview',{item,collection:selected.selection.collection});
    if(response.ok&&response.headers.get('Content-Type')?.startsWith('image/')){
      preview={url:URL.createObjectURL(await response.blob())};
    }else{
      const result=await response.json();
      preview={result:result.status?result:{status:'invalid',message:result.error}};
    }
  }catch{
    preview={result:{status:'offline',message:'Não foi possível obter a miniatura.'}};
  }finally{
    if(module.results.stac===selected){
      if(module.previews[item]?.url) URL.revokeObjectURL(module.previews[item].url);
      module.previews[item]=preview;
    }else if(preview?.url) URL.revokeObjectURL(preview.url);
    module.previewPending=null;
    renderEnvironment();
    refreshEnvironmentStatus();
  }
}

$('#menu').addEventListener('click',()=>{
  const expanded=$('#rail').classList.toggle('open');
  $('#menu').setAttribute('aria-expanded',String(expanded));
});
dialog.addEventListener('close',()=>{
  if(dialogOwner?.isConnected){dialogOwner.focus({preventScroll:true});return;}
  const prev=dialogOwner?.dataset.action;
  if(prev) view.querySelector(`[data-action="${prev}"]`)?.focus({preventScroll:true});
});
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');
  if(!target || target.disabled) return;
  if (dialog.open && target.dataset.action==='guide_start') dialog.close();
  actions[target.dataset.action]?.(target.dataset.value,target.dataset.mode);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!dialog.open) closeMenu();
  if(event.target.classList.contains('plot-point')&&(event.key==='Enter'||event.key===' ')){
    event.preventDefault();
    inspect(event.target.dataset.value);
  }
});
function pointLabel(event){
  const point=event.target.closest('[data-point]');
  const label=$('#chart-tooltip');
  if(point&&label) label.textContent=point.dataset.point;
}
view.addEventListener('focusin',pointLabel);
view.addEventListener('pointerover',pointLabel);
view.addEventListener('input',event=>{
  const form=event.target.closest('form[data-env]');
  if(form) rememberField(model.environment,form,event.target);
});
view.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-env]');
  if(!form) return;
  event.preventDefault();
  searchEnvironment(form.dataset.env,event.submitter?.dataset.force==='true');
});
crewSelect.addEventListener('change',event=>selectCrew(event.target.value));
view.addEventListener('change',event=>{
  const target=event.target;
  const key=target.dataset.change;
  if(!key) return;
  if(key==='threshold'){
    model.threshold=target.value===''?120:Math.max(0,Math.min(500,Number(target.value)));
  }else{
    model[key]=target.value;
  }
  render();
});
dialog.addEventListener('submit',async(event)=>{
  const form=event.target;
  const kind=form.dataset.form;
  if(!kind) return;
  event.preventDefault();
  if(model.busy) return;
  const values=new FormData(form);
  const details=kind==='new'?{activity:values.get('activity')}:{label:kind==='review'?'Revisão técnica':values.get('label'),text:values.get('text'),authorized:values.has('authorized')};
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;
  const saved=await operation(kind,details);
  submit.disabled=false;
  if(saved&&dialog.contains(form)){dialog.close();return;}
  const error=form.querySelector('.form-result');
  if(error) error.textContent='O registro não foi confirmado. Confira o motivo na mensagem do simulador.';
});
window.addEventListener('hashchange',route);
route(false);
refresh();

