// Gera agenda.ics (calendário com alertas para assinar no iPhone) a partir dos dados do index.html.
// Uso: node tools/gerar_ics.js   (roda na pasta do repositório)
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('const COURSES={'),b=html.indexOf('BASE.forEach(e=>{e.bk=');
if(a<0||b<0)throw new Error('não achei os dados no index.html');
const ctx={};vm.createContext(ctx);
vm.runInContext(html.slice(a,b).replace(/^const /gm,'var ')+'\nvar __out={COURSES,BASE};',ctx);
const {COURSES,BASE}=ctx.__out;
let cb=null;try{cb=JSON.parse(fs.readFileSync('cb.json','utf8'))}catch(e){}

// aplica a última leitura do calendário do CB (mesma regra do app)
const evs=BASE.map(e=>({...e,bk:e.d+'|'+e.c+'|'+e.t}));
if(cb&&Array.isArray(cb.provas)){
  for(const p of cb.provas){
    const e=evs.find(x=>x.c===p.codigo&&x.cb===p.avaliacao);
    if(e&&e.d!==p.data)e.d=p.data;
  }
}

const KIND={prova:'Prova',teste:'Teste',entrega:'Entrega',apres:'Apresentação',prep:'Preparação',aula:'Aula'};
// Alertas por tipo: [dias antes, hora local]
const ALERTAS={
  prova:[[3,9],[1,20],[0,7]],
  teste:[[3,9],[1,20],[0,7]],
  entrega:[[2,20],[0,9]],
  apres:[[1,20],[0,7]],
};
const BRT=-3; // Rio de Janeiro, sem horário de verão
const pad=n=>String(n).padStart(2,'0');
const utc=(y,m,d,h,mi)=>new Date(Date.UTC(y,m-1,d,h-BRT,mi));
const fmt=dt=>dt.getUTCFullYear()+pad(dt.getUTCMonth()+1)+pad(dt.getUTCDate())+'T'+pad(dt.getUTCHours())+pad(dt.getUTCMinutes())+'00Z';
const dur=ms=>{const neg=ms<0;let s=Math.abs(ms)/1000;const d=Math.floor(s/86400);s-=d*86400;const h=Math.floor(s/3600);s-=h*3600;const m=Math.floor(s/60);
  return (neg?'-':'')+'P'+(d?d+'D':'')+(h||m||!d?'T'+(h?h+'H':'')+(m?m+'M':'')+(!h&&!m?'0M':''):'')};
const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/;/g,'\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
const fold=l=>{const out=[];let s=l;while(Buffer.byteLength(s)>74){let n=74;while(Buffer.byteLength(s.slice(0,n))>74)n--;out.push(s.slice(0,n));s=' '+s.slice(n)}out.push(s);return out.join('\r\n')};

// horário: "até 23h59" vira prazo nesse horário; "11h", "17h–18h50", "07h–09h" viram início/fim
function horario(h){
  if(!h)return null;
  const ate=/até\s*(\d{1,2})h(\d{2})?/.exec(h);
  if(ate)return {ini:[+ate[1],+(ate[2]||0)],fim:null,prazo:true};
  const r=/(\d{1,2})h(\d{2})?\s*[–-]\s*(\d{1,2})h(\d{2})?/.exec(h);
  if(r)return {ini:[+r[1],+(r[2]||0)],fim:[+r[3],+(r[4]||0)]};
  const s=/(?:^|\s)(\d{1,2})h(\d{2})?(?!\w)/.exec(h);
  if(s)return {ini:[+s[1],+(s[2]||0)],fim:null};
  return null;
}

const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Agenda 2026.2//PT-BR','CALSCALE:GREGORIAN','METHOD:PUBLISH',
  'X-WR-CALNAME:Agenda 2026.2','X-WR-TIMEZONE:America/Sao_Paulo','REFRESH-INTERVAL;VALUE=DURATION:PT6H','X-PUBLISHED-TTL:PT6H'];
const agora=fmt(new Date());
for(const e of evs){
  if(!KIND[e.k])continue;
  const [y,m,d]=e.d.split('-').map(Number);
  const C=COURSES[e.c]||{name:e.c};
  const hr=horario(e.h);
  const titulo=e.t.split(' (')[0];
  L.push('BEGIN:VEVENT');
  L.push('UID:'+crypto.createHash('sha1').update(e.bk).digest('hex').slice(0,20)+'@agenda20262');
  L.push('DTSTAMP:'+agora);
  let inicio;
  if(hr){
    inicio=utc(y,m,d,hr.ini[0],hr.ini[1]);
    const fim=hr.fim?utc(y,m,d,hr.fim[0],hr.fim[1]):new Date(inicio.getTime()+(hr.prazo?0:3600e3));
    if(hr.prazo){ // prazo: bloco de 30 min terminando no horário-limite
      L.push('DTSTART:'+fmt(new Date(inicio.getTime()-30*60e3)));L.push('DTEND:'+fmt(inicio));
      inicio=new Date(inicio.getTime()-30*60e3);
    }else{L.push('DTSTART:'+fmt(inicio));L.push('DTEND:'+fmt(fim))}
  }else{
    const prox=new Date(Date.UTC(y,m-1,d+1));
    L.push('DTSTART;VALUE=DATE:'+e.d.replace(/-/g,''));
    L.push('DTEND;VALUE=DATE:'+prox.toISOString().slice(0,10).replace(/-/g,''));
    inicio=utc(y,m,d,0,0);
  }
  L.push(fold('SUMMARY:'+esc(`${KIND[e.k]} · ${C.name} · ${titulo}`)));
  L.push(fold('DESCRIPTION:'+esc([e.t,e.h,C.name+' ('+e.c+')',e.src].filter(Boolean).join('\n'))));
  if(e.src)L.push(fold('URL:'+e.src));
  for(const [dias,hora] of (ALERTAS[e.k]||[])){
    const alvo=utc(y,m,d-dias,hora,0);
    if(hr&&!hr.prazo&&alvo>=inicio)continue; // não avisa depois do começo
    if(!hr&&alvo>=utc(y,m,d,12,0))continue;   // dia inteiro: no máximo até o meio-dia
    if(hr&&hr.prazo&&alvo>new Date(inicio.getTime()+30*60e3))continue;
    const quando=dias===0?'hoje':dias===1?'amanhã':`em ${dias} dias`;
    L.push('BEGIN:VALARM','ACTION:DISPLAY',fold('DESCRIPTION:'+esc(`${quando}: ${C.name} · ${titulo}`)),'TRIGGER:'+dur(alvo-inicio),'END:VALARM');
  }
  if(hr&&hr.prazo)L.push('BEGIN:VALARM','ACTION:DISPLAY',fold('DESCRIPTION:'+esc(`faltam 3 horas: ${C.name} · ${titulo}`)),'TRIGGER:'+dur(-150*60e3),'END:VALARM');
  L.push('END:VEVENT');
}
L.push('END:VCALENDAR');
fs.writeFileSync('agenda.ics',L.join('\r\n')+'\r\n');
console.log('agenda.ics:',L.filter(l=>l==='BEGIN:VEVENT').length,'eventos,',L.filter(l=>l==='BEGIN:VALARM').length,'alertas');
