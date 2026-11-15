const paths = {
  orbit:'<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="1"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  users:'<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
  pulse:'<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  shield:'<path d="M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  box:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10m-10 5h3m3 0h4"/>',
  radio:'<circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10m10-10a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/>',
  activity:'<path d="M9 5h6l3 6 3 1M12 5l-4 6-5 2m8-3 5 5 1 5m-6-6-4 5H3"/><circle cx="15" cy="3" r="2"/>',
  flask:'<path d="M9 3h6m-5 0v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8"/>',
  capsule:'<path d="M20 4a5 5 0 0 1 0 7l-9 9a5 5 0 0 1-7-7l9-9a5 5 0 0 1 7 0ZM8 9l7 7"/>',
  book:'<path d="M3 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H3V4Zm18 0h-6a3 3 0 0 0-3 3m9-3v14h-6a3 3 0 0 0-3 3"/>',
  play:'<path fill="currentColor" stroke="none" d="m8 5 12 7-12 7z"/>',
  pause:'<path d="M9 5v14m6-14v14"/>',
  right:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  left:'<path d="M20 12H5m6-6-6 6 6 6"/>',
  reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link:'<path d="M7 14 5 16a3 3 0 0 0 4 4l5-5a3 3 0 0 0 0-4m3-1 2-2a3 3 0 0 0-4-4l-5 5a3 3 0 0 0 0 4"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  temp:'<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0Z"/><path d="M12 10v7m4-10h3m-3 3h2"/>',
  oxygen:'<path d="M12 3C10 7 6 10 6 15a6 6 0 0 0 12 0c0-5-4-8-6-12Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>',
  battery:'<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M22 10v4M7 10v4m4-4v4m4-4v4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  close:'<path d="m5 5 14 14M19 5 5 19"/>',
};

export const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.orbit) + '</svg>';
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, chr => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[chr]));
export const time = (value) => value ? new Date(value).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
export const date = (value) => value ? new Date(value).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}) : '—';
export const fmt = (value, precision=2) => value == null ? 'Indisponível' : new Intl.NumberFormat('pt-BR',{maximumFractionDigits:precision,minimumFractionDigits:0}).format(value);
export const expUrl = (s) => '/api/export?crew=' + encodeURIComponent(s.session.astronaut_id) + '&session=' + encodeURIComponent(s.session.id);
export const initials = (name) => name.split(' ').map(part => part[0]).join('');
export const button = (label, action, {symbol='', style='', value='', disabled=false, extra=''}={}) =>
  `<button type="button" class="btn ${style}" data-action="${action}" data-value="${esc(value)}" ${disabled?'disabled':''} ${extra}>${symbol?icon(symbol):''}${label}</button>`;
export const link = (label, page, symbol='', style='') => `<a href="#${page}" class="btn ${style}">${symbol?icon(symbol):''}${label}</a>`;
export const badge = (label, kind='') => `<span class="status ${kind}"><i class="dot"></i>${esc(label)}</span>`;
export const tag = (label) => `<span class="tag">${esc(label)}</span>`;
export const empty = (label) => `<p class="empty">${label}</p>`;
export const title = (name, sub='', eyebrow='') => `<div class="panel-head"><div>${eyebrow?`<div class="eyebrow">${eyebrow}</div>`:''}<h2>${name}</h2>${sub?`<p>${sub}</p>`:''}</div></div>`;
export const delivery = {
  waiting:['Aguardando',''], sending:['Enviando','violet'], sent:['Enviado · aguarda confirmação','violet'],
  confirmed:['Confirmado pelo receptor','ok'], error:['Erro · pode reenviar','warn'], conflict:['Conflito','bad'],
};
export const quality = {
  usable:['Disponível','ok'], disconnected:['Indisponível','warn'], low_battery:['Bateria baixa','warn'],
  stale:['Desatualizada','warn'], out_of_order:['Fora de ordem','warn'],
};
export const status = (mapping,key) => badge(...(mapping[key] || ['Somente local','']));
export const table = (columns, rows) => rows.length
  ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela de dados"><table><thead><tr>${columns.map(c=>`<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : empty('Nenhum registro para este filtro.');
export const phases = ['preparação','exercício','recuperação','encerrada'];
export const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
export const readings = (s,metric) => s.records.filter(r => r.metric_code===metric);
export const latest = (s,metric) => {
  const device = activeDevices(s).find(d=>d.type===s.metrics[metric][4]);
  return readings(s,metric).findLast(r=>r.device_id===device?.id&&r.quality!=='out_of_order');
};
export const activeDevices = s => s.devices.filter(d=>d.connection!=='revoked');
export const deviceIcon = kind => ({shirt:'pulse',watch:'clock',left:'activity',right:'activity',treadmill:'layers',capsule:'capsule'}[kind]);
export const linkBadge = s => badge(s.session.link?'Enlace ativo':'Enlace interrompido',s.session.link?'ok':'warn');
export const context = (s) => `<div class="context-info">${tag(s.session.astronaut_id+' / '+s.crew[s.session.astronaut_id].name)}${tag(s.session.id)}${badge(cap(s.session.phase),'violet')}${linkBadge(s)}${badge(activeDevices(s).filter(d=>d.connection==='online').length+'/'+activeDevices(s).length+' sensores conectados')}</div>`;

export function seriesPath(points) {
  let wasMissing = true;
  return points.map(point => {
    if (!point) { wasMissing=true; return ''; }
    const command = wasMissing ? 'M' : 'L';
    wasMissing = false;
    return command+point.join(',');
  }).join(' ');
}

export function chart(s, metric, range='all') {
  let data = readings(s,metric).slice().sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at));
  const limit = range==='recent'?8:range==='all'?36:Infinity;
  if (limit===Infinity) data=data.filter(r=>r.phase===range);
  else data=data.slice(-limit);
  if (!data.length) return empty('Sem leituras para esta métrica e este período.');
  const unit=s.metrics[metric][1];
  const values=data.filter(r=>r.value!=null).map(r=>r.value);
  const minimum=Math.min(...values), maximum=Math.max(...values);
  const floor=values.length?minimum-(maximum-minimum||1)*.2:0;
  const ceil=values.length?maximum+(maximum-minimum||1)*.2:1;
  const x=i=>62+i/Math.max(1,data.length-1)*654;
  const y=value=>180-(value-floor)/(ceil-floor)*140;
  const points=data.map((r,i)=>r.value==null?null:[x(i),y(r.value)]);
  const lines=Array.from({length:5},(_,i)=>{
    const yy=40+i*35;
    return `<line x1="62" x2="721" y1="${yy}" y2="${yy}" class="plot-grid"/><text x="53" y="${yy+4}" text-anchor="end">${values.length?fmt(ceil-i*(ceil-floor)/4, s.metrics[metric][1]==='°C'?2:1):'—'}</text>`;
  }).join('');
  const ticks=Array.from(new Set([0,Math.floor((data.length-1)/3),Math.floor((data.length-1)*2/3),data.length-1])).map(i=>
    `<text x="${x(i)}" y="206" text-anchor="${i===0?'start':i===data.length-1?'end':'middle'}">${time(data[i].captured_at).slice(0,5)}</text>`).join('');
  const selected=points.map((point,i)=>{
    const r=data[i];
    const value=r.value==null?'Indisponível':fmt(r.value)+' '+unit;
    const label=esc(value+' · '+time(r.captured_at)+' · '+r.quality_reason);
    if (!point) return `<g><line x1="${x(i)}" x2="${x(i)}" y1="38" y2="180" class="plot-gap"/><circle class="plot-point plot-point-missing" role="button" tabindex="0" data-action="reading" data-value="${esc(r.event_id)}" data-point="${label}" aria-label="${label}" cx="${x(i)}" cy="167" r="4.5"><title>${label}</title></circle></g>`;
    return `<circle class="plot-point" role="button" tabindex="0" data-action="reading" data-value="${esc(r.event_id)}" data-point="${label}" aria-label="${label}" cx="${point[0]}" cy="${point[1]}" r="3.5"><title>${label}</title></circle>`;
  }).join('');
  const rows=data.slice().reverse().map(r=>[time(r.captured_at),time(r.received_at),r.value==null?'Indisponível':fmt(r.value)+' '+esc(r.unit),esc(cap(r.phase)),status(quality,r.quality),`<span class="id-text">${esc(r.device_id)}</span>`,button('Inspecionar','reading',{value:r.event_id})]);
  return `<div class="legend"><span><i></i>Sintético${s.metrics[metric][5]?' · estimado':''}</span><span><i class="gap"></i>Ausência de sinal</span></div>
    <svg class="chart" viewBox="0 0 740 224" role="group" aria-label="Curva de ${esc(s.metrics[metric][0])}. Use Tab para inspecionar cada ponto.">
    <text x="19" y="23">${esc(unit)}</text>${lines}${ticks}<path d="${seriesPath(points)}" class="plot-line"/>${selected}</svg>
    <p class="chart-tooltip" id="chart-tooltip">Selecione um ponto para ver a origem e a qualidade da leitura.</p>
    <div class="phase-strip">${phases.slice(0,3).map(p=>`<span class="${p===s.session.phase?'current':''}">${cap(p)}</span>`).join('')}</div>
    <details class="inline-details"><summary>Ver leituras em tabela</summary>${table(['Captura','Recebimento','Valor','Fase','Qualidade','Dispositivo',''],rows)}</details>`;
}

