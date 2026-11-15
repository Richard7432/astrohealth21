// The public demo uses a browser-scoped mission and a simulated receiver.
const {crew, devices: deviceInfo, guide, metrics, phases, values} = fixtures;
const kinds = {reading:'Controle de missão',checkin:'Apoio de bordo',review:'Controle de missão'};
const qualities = {usable:'Amostra sintética disponível',disconnected:'Sensor sem conexão',low_battery:'Bateria baixa no dispositivo',
  stale:'Atraso simulado do sensor',out_of_order:'Amostra recebida fora de ordem'};
const readingFields = ['event_id','astronaut_id','session_id','device_id','device_type','metric_code','value','unit',
  'origin','captured_at','phase','quality','schema_version','sequence'];
const stamp = (offset=0)=>new Date(Date.now()+offset*1000).toISOString();
const identifier = ()=>crypto.randomUUID().replaceAll('-','');
const answer = (message,status=200)=>({message,status});
function audit(current,action,detail='',event_id=null) {
  current.audit.unshift({seq:++current.seq,at:stamp(),session_id:current.session.id,action,detail,event_id});
  current.audit.splice(80);
}
function findSession(mission, profile, id) {
  if (!Object.hasOwn(crew,profile)) throw new Error('Perfil fictício inválido.');
  const current=mission.sessions.find(entry=>entry.session.astronaut_id===profile && (id ? entry.session.id===id : entry.session.selected));
  if(!current) throw new Error('Sessão indisponível para este perfil.');
  return current;
}
function createSession(mission,profile,activity,seeded=false,guided=false) {
  for(const old of mission.sessions) if(old.session.astronaut_id===profile) old.session.selected=0;
  const id=(seeded?'SIM':'EX')+'-'+profile+'-'+identifier().slice(0,12).toUpperCase();
  const session={id,astronaut_id:profile,activity,phase:phases[seeded?2:0],started:stamp(seeded?-1020:guided?-45:0),
    ended:null,link:1,step:guided?0:null,selected:1,storage_fault:0};
  const devices=Object.entries(deviceInfo).map(([type,info])=>({id:id+'-'+info.code,session_id:id,type,battery:info.battery,connection:'online'}));
  const current={session,devices,records:[],audit:[],seq:0,receipts:{}};
  mission.sessions.unshift(current);
  return current;
}
function saveRecord(current,kind,payload,authorized=true) {
  if(current.session.storage_fault){
    audit(current,'Escrita simulada bloqueada','Falha injetada antes de persistir.',payload.event_id);
    return answer('Falha simulada de armazenamento. Registro não salvo.',503);
  }
  if(current.records.length>=330) return answer('Limite de registros da sessão atingido. Abra uma nova sessão.',409);
  const received_at=stamp();
  const out=authorized?{state:'waiting',attempts:0,receiver:kinds[kind],created:received_at,ack_at:null,last_error:null}
    :{state:null,attempts:null,receiver:null,created:null,ack_at:null,last_error:null};
  current.records.push({kind,payload,authorized,received_at,out});
  return answer('Registro salvo.');
}
function packet(current,device,code,value,captured_at,quality,phase,sequence=0){
  return {event_id:identifier(),astronaut_id:current.session.astronaut_id,session_id:current.session.id,device_id:device.id,
    device_type:device.type,metric_code:code,value,unit:metrics[code][1],origin:'synthetic',captured_at,phase,quality,schema_version:1,sequence};
}
function ingest(mission,current,raw){
  const reject=(message)=>{
    audit(current,'Leitura rejeitada',message,typeof raw.event_id==='string'?raw.event_id.slice(0,100):null);
    return answer(message,422);
  };
  const p=Object.fromEntries(readingFields.map(key=>[key,raw[key]]));
  if(typeof p.event_id!=='string'||!/^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(p.event_id)) return reject('Identificador inválido.');
  if(p.astronaut_id!==current.session.astronaut_id||p.session_id!==current.session.id) return reject('Vínculo de astronauta ou sessão inválido.');
  const device=current.devices.find(d=>d.id===p.device_id&&d.connection!=='revoked'&&d.type===p.device_type);
  if(!device) return reject('Dispositivo incompatível, desconhecido ou revogado.');
  if(!Object.hasOwn(metrics,p.metric_code)||metrics[p.metric_code][4]!==device.type) return reject('Métrica incompatível.');
  if(p.unit!==metrics[p.metric_code][1]) return reject('Unidade incompatível com a métrica.');
  if(!phases.slice(0,3).includes(p.phase)||p.origin!=='synthetic'||p.schema_version!==1) return reject('Use uma fase ativa e o esquema sintético v1.');
  if(typeof p.captured_at!=='string'||p.captured_at.length>50||!/(Z|[+-]\d\d:\d\d)$/.test(p.captured_at)||
    !Number.isFinite(Date.parse(p.captured_at))||Date.parse(p.captured_at)>Date.now()+120000) return reject('Horário inválido, futuro ou sem fuso.');
  if(!Object.hasOwn(qualities,p.quality)||!Number.isSafeInteger(p.sequence)||p.sequence<0) return reject('Qualidade ou sequência inválida.');
  if((p.quality==='disconnected')!==(p.value===null)) return reject('Amostra sem sinal precisa conter valor nulo.');
  if(p.value!==null&&(!Number.isFinite(p.value)||p.value<metrics[p.metric_code][2]||p.value>metrics[p.metric_code][3])) return reject('Valor fora da faixa instrumental sintética.');
  for(const row of mission.sessions){
    const prev=row.records.find(record=>record.payload.event_id===p.event_id);
    if(!prev) continue;
    const same=prev.kind==='reading'&&JSON.stringify(prev.payload)===JSON.stringify(p);
    audit(current,same?'Duplicata ignorada':'Conflito','Registro original preservado.',p.event_id);
    return answer(same?'Duplicata ignorada.':'Conflito de identificador.',same?200:409);
  }
  return saveRecord(current,'reading',p);
}
function sample(current,i,phase,captured_at=stamp(),gap=[]) {
  if(current.session.storage_fault||current.records.length+Object.keys(metrics).length>330) return answer(
    current.session.storage_fault?'Falha simulada de armazenamento. Registro não salvo.':'Limite de amostras desta sessão.',current.session.storage_fault?503:409);
  const bucket=values[current.session.astronaut_id][i%18];
  for(const [code,value] of Object.entries(bucket)){
    const device=current.devices.find(d=>d.type===metrics[code][4]&&d.connection!=='revoked');
    const disconnected=device.connection==='offline'||gap.includes(device.type);
    const p=packet(current,device,code,disconnected?null:value,captured_at,disconnected?'disconnected':device.battery<20?'low_battery':'usable',phase,i);
    saveRecord(current,'reading',p);
  }
  return answer('Amostras sintéticas registradas.');
}
function note(current,kind,{text='',label,authorized=false}){
  const labels=kind==='checkin'?['Dentro do esperado','Quero revisar a sessão']:['Revisão técnica'];
  if(typeof text!=='string'||text.trim().length>240||!labels.includes(label)||typeof authorized!=='boolean') throw new Error('Registro fictício inválido.');
  const p={event_id:identifier(),astronaut_id:current.session.astronaut_id,session_id:current.session.id,
    phase:current.session.phase,origin:'synthetic',schema_version:1,label,text:text.trim(),captured_at:stamp()};
  const result=saveRecord(current,kind,p,authorized);
  if(result.status===200) audit(current,label,authorized?'Incluído na fila autorizada.':'Somente local.',p.event_id);
  return result;
}
function deliver(current,mode){
  if(!['prepare','interrupt','send','lose_ack','remote_conflict','ack'].includes(mode)) throw new Error('Modo de entrega inválido.');
  if(!current.session.link) return answer('Enlace interrompido. Registros continuam na fila.');
  const queued=current.records.filter(r=>r.authorized&&!['confirmed','conflict'].includes(r.out.state));
  const eligible=mode==='ack'?queued.filter(r=>r.out.state==='sent'):mode==='remote_conflict'?queued.slice(0,1):queued;
  let confirmed=0;
  if(mode==='interrupt') current.session.link=0;
  for(const record of eligible){
    const {out,payload}=record;
    const receipt=current.receipts[payload.event_id];
    if(mode==='ack'){
      if(receipt===true){out.state='confirmed';out.ack_at=stamp();out.last_error=null;confirmed++;}
      else {out.state=receipt===false?'conflict':'error';out.last_error=receipt===false?'Conteúdo divergente no receptor.':'Recibo indisponível.';}
    }else if(mode==='prepare'){out.state='sending';out.last_error=null;}
    else if(mode==='interrupt'){out.state='error';out.last_error='Enlace caiu durante o envio.';out.attempts++;}
    else {
      if(!Object.hasOwn(current.receipts,payload.event_id)) current.receipts[payload.event_id]=mode!=='remote_conflict';
      out.state='sent';out.attempts++;out.last_error=mode==='lose_ack'?'Confirmação perdida no cenário.':null;
    }
  }
  const message={
    ack:confirmed+' registros confirmados pelo receptor fictício.',prepare:eligible.length+' registros na etapa de envio.',
    interrupt:'Enlace interrompido durante o envio. Registros preservados.',
  }[mode]??(eligible.length+' registros enviados. Aguardando confirmação.');
  audit(current,mode==='ack'?'Confirmação do receptor':'Fila de sincronização',message);
  return answer(message);
}
function advance(current,expected){
  const s=current.session;
  if(s.step===null||s.step>=7) return answer('Cenário concluído ou indisponível.');
  if(s.step!==expected) return answer('Atualize a etapa antes de avançar.',409);
  if(s.storage_fault) return answer('Desative a falha de armazenamento antes de avançar.',503);
  if(s.phase===phases[3]) return answer('Esta sessão foi encerrada.',409);
  const step=s.step+1, shirt=current.devices.find(d=>d.type==='shirt'&&d.connection!=='revoked');
  if(step===6&&!s.link) return answer('Religue o enlace antes de confirmar.',409);
  const sampleCount={1:7,2:2,7:5}[step]??0;
  if(current.records.length+sampleCount*Object.keys(metrics).length+(step===3||step===4?1:0)>330) return answer('Limite de amostras desta sessão.',409);
  const simTime=i=>new Date(Date.parse(s.started)+i*2000).toISOString();
  if(step===1){s.phase=phases[1];for(let i=3;i<10;i++)sample(current,i,s.phase,simTime(i));}
  if(step===2){shirt.connection='offline';for(const i of [10,11])sample(current,i,phases[1],simTime(i));}
  if(step===3) note(current,'checkin',{text:'Gostaria de revisar a perda de sinal durante o exercício.',label:'Quero revisar a sessão',authorized:true});
  if(step===4){s.link=0;note(current,'review',{text:'Revisão do sensor torácico durante o exercício.',label:'Revisão técnica',authorized:true});}
  if(step===5){s.link=1;deliver(current,'lose_ack');}
  if(step===6){deliver(current,'send');deliver(current,'ack');}
  if(step===7){shirt.connection='online';s.phase=phases[2];for(let i=13;i<18;i++)sample(current,i,s.phase);}
  s.step=step;
  audit(current,'Etapa guiada',guide[step][0]);
  return answer(guide[step][0]);
}
function deviceAction(current,id,mode){
  const s=current.session;
  if(s.phase===phases[3]) return answer('Selecione uma sessão ativa.',409);
  const d=current.devices.find(d=>d.id===id&&d.connection!=='revoked');
  if(!d||!['replace','offline','online','battery','stale'].includes(mode)) throw new Error('Dispositivo ou comando indisponível.');
  if(s.storage_fault) return answer('Falha simulada de armazenamento. Alteração não salva.',503);
  if(mode==='replace'){
    if(current.devices.length>=30) return answer('Limite de substituições desta sessão.',409);
    d.connection='revoked';
    const replacement={...d,id:d.id.split('-RPL-')[0]+'-RPL-'+identifier().slice(0,6).toUpperCase(),connection:'online',battery:deviceInfo[d.type].battery};
    current.devices.push(replacement); audit(current,'Dispositivo substituído',replacement.id);
    return answer('Novo dispositivo associado. Histórico preservado.');
  }
  const codes=Object.keys(metrics).filter(key=>metrics[key][4]===d.type);
  if(current.records.length+codes.length>330) return answer('Limite de amostras desta sessão.',409);
  if(['online','offline'].includes(mode)) d.connection=mode;
  if(mode==='battery'){d.connection='online';d.battery=12;}
  const quality=d.connection==='offline'?'disconnected':mode==='stale'?'stale':d.battery<20?'low_battery':'usable';
  for(const code of codes){
    const value=quality==='disconnected'?null:values[s.astronaut_id][14][code];
    saveRecord(current,'reading',packet(current,d,code,value,stamp(mode==='stale'?-900:0),quality,s.phase==='encerrada'?phases[2]:s.phase));
  }
  audit(current,'Cenário de dispositivo',deviceInfo[d.type].label+' · '+qualities[quality]);
  return answer(qualities[quality]);
}
function failure(mission,current,mode){
  const shirt=current.devices.find(d=>d.type==='shirt'&&d.connection!=='revoked');
  let p=packet(current,shirt,'thermal',37.1,stamp(),'usable',phases[1]);
  if(mode==='unit') p.unit='°F';
  else if(mode==='clock') p.captured_at='sem fuso';
  else if(mode==='profile') p.device_id=findSession(mission,current.session.astronaut_id==='A12'?'B07':'A12').devices[0].id;
  else if(mode==='unknown') p.device_id='SEM-CADASTRO';
  else if(mode==='order'){p.captured_at=stamp(-900);p.quality='out_of_order';}
  else if(['duplicate','conflict'].includes(mode)){
    const existing=current.records.find(r=>r.kind==='reading'&&current.devices.some(d=>d.id===r.payload.device_id&&d.connection!=='revoked'));
    if(!existing) return answer('Gere uma leitura antes de simular o reenvio.',409);
    p={...existing.payload};
    if(mode==='conflict'){p.value=p.value===null?37:p.value+0.1;if(p.quality==='disconnected')p.quality='usable';}
  }else throw new Error('Cenário de falha inválido.');
  return ingest(mission,current,p);
}
function newMission(){
  const mission={sessions:[]};
  for(const profile of Object.keys(crew)){
    const current=createSession(mission,profile,'Esteira orbital',true);
    for(let i=0;i<18;i++) sample(current,i,phases[i<3?0:i<13?1:2],stamp((i-17)*60),[10,11].includes(i)?['shirt']:[]);
    audit(current,'Sessão de demonstração carregada');
  }
  return mission;
}
function missionView(mission,profile,id){
  const current=findSession(mission,profile,id);
  const records=current.records.map(record=>{
    const p=record.payload;
    const details=record.kind==='reading'?{estimated:metrics[p.metric_code][5],calibration:'não aplicável · simulação',
      quality_reason:qualities[p.quality],method:metrics[p.metric_code][5]?'Curva determinística do cenário v1':'Gerador sintético v1'}:{};
    return {...p,...details,kind:record.kind,received_at:record.received_at,authorized:record.authorized,...record.out};
  });
  return {mode:'sintético',stage:'public',crew,session:current.session,records,devices:current.devices,device_info:deviceInfo,
    history:mission.sessions.filter(row=>row.session.astronaut_id===profile).map(row=>row.session),guide,metrics,audit:current.audit,protocol:null,server_time:stamp()};
}
function missionAction(mission,data){
  let current=findSession(mission,data.crew,data.session_id);
  const s=current.session;
  let result=answer('Operação registrada.');
  switch(data.op){
    case 'new': case 'guide_start': {
      const activity=data.activity??'Esteira orbital';
      if(!['Esteira orbital','Cicloergômetro','Treino resistido'].includes(activity)) throw new Error('Atividade inválida.');
      if(mission.sessions.length>=8){result=answer('Limite de oito sessões deste navegador.',409);break;}
      current=createSession(mission,data.crew,activity,false,data.op==='guide_start');
      for(let i=0;i<3;i++)sample(current,i,phases[0],new Date(Date.parse(current.session.started)+i*2000-4000).toISOString());
      audit(current,'Sessão iniciada',activity);result=answer('Nova sessão iniciada.');break;
    }
    case 'phase':
      if(!phases.includes(data.phase)||s.phase===phases[3]) throw new Error('Selecione uma fase de uma sessão ativa.');
      s.phase=data.phase;if(s.phase===phases[3])s.ended=stamp();audit(current,'Fase alterada',s.phase);break;
    case 'sample':
      if(s.phase===phases[3]) throw new Error('Sessão encerrada.');
      result=sample(current,1+Math.max(-1,...current.records.filter(r=>r.kind==='reading').map(r=>r.payload.sequence)),s.phase);
      if(result.status===200) audit(current,'Amostras geradas',result.message);break;
    case 'link': s.link=1-s.link;result=answer(s.link?'Enlace disponível.':'Enlace interrompido.');audit(current,'Enlace simulado',result.message);break;
    case 'storage': s.storage_fault=1-s.storage_fault;result=answer(s.storage_fault?'Falha de armazenamento ativada.':'Armazenamento restaurado.');audit(current,'Falha de armazenamento',result.message);break;
    case 'checkin': case 'review': result=note(current,data.op,data);break;
    case 'sync': result=deliver(current,data.mode);break;
    case 'device': result=deviceAction(current,data.device,data.mode);break;
    case 'fail': result=failure(mission,current,data.mode);break;
    case 'ingest':
      if(!data.reading||typeof data.reading!=='object'||Array.isArray(data.reading))throw new Error('Informe uma leitura.');
      result=ingest(mission,current,data.reading);break;
    case 'guide_next': result=advance(current,data.expected_step);break;
    default: throw new Error('Operação desconhecida.');
  }
  return {...result,saved:result.status===200,session_id:current.session.id};
}

