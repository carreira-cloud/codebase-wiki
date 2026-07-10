import { join } from "node:path";
import { getClient } from "./lancedb/client";
import type { WikiDoc, WikiNote } from "./types";

export async function startUIServer(port: number, dbPath: string) {
  const client = getClient(dbPath);
  await client.connect();

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === "/") return html(renderHomePage());

      if (url.pathname === "/api/services") {
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = parseInt(url.searchParams.get("limit") || "20", 10);
        const all = await client.listServices();
        return json({ services: all.slice(offset, offset + limit), total: all.length });
      }

      if (url.pathname === "/api/service") {
        const name = url.searchParams.get("name") || "";
        const doc = await client.getDoc(name);
        return doc ? json(doc) : notFound();
      }

      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") || "";
        const sq = q.toLowerCase();
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = parseInt(url.searchParams.get("limit") || "20", 10);
        const allDocs = await client.searchDocs(q);
        const allNotes = await client.searchNotes(q);
        const allFlows = (await client.listFlows()).filter(f =>
          (f.flowName || "").toLowerCase().includes(sq) ||
          (f.summary || "").toLowerCase().includes(sq) ||
          f.keywords.some(k => k.toLowerCase().includes(sq)) ||
          (f.serviceName || "").toLowerCase().includes(sq)
        );
        return json({
          docs: allDocs.slice(offset, offset + limit),
          notes: allNotes.slice(offset, offset + limit),
          flows: allFlows.slice(offset, offset + limit),
          totalDocs: allDocs.length, totalNotes: allNotes.length, totalFlows: allFlows.length,
        });
      }

      if (url.pathname === "/api/notes") {
        const type = url.searchParams.get("type") || undefined;
        const service = url.searchParams.get("service") || undefined;
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        let all = await client.listNotes(type);
        if (service) all = all.filter(n => (n.context || "").toLowerCase().includes(service.toLowerCase()) || (n.topic || "").toLowerCase().includes(service.toLowerCase()));
        return json({ notes: all.slice(offset, offset + limit), total: all.length });
      }

      if (url.pathname === "/api/stats") {
        const stats = await client.stats();
        const flows = await client.listFlows();
        const serviceFlows: Record<string, number> = {};
        const serviceNotes: Record<string, number> = {};
        for (const f of flows) { const s = f.serviceName; serviceFlows[s] = (serviceFlows[s] || 0) + 1; }
        const allNotes = await client.listNotes();
        for (const n of allNotes) { const ctx = n.context || ""; const parts = ctx.split("/"); const s = parts[0] || "unknown"; serviceNotes[s] = (serviceNotes[s] || 0) + 1; }
        return json({ ...stats, serviceFlows, serviceNotes });
      }

      if (url.pathname === "/api/note" && req.method === "POST") {
        const body = await req.json() as Partial<WikiNote>;
        const id = Buffer.from(`${body.topic}_${Date.now()}`).toString("hex").slice(0, 12);
        await client.addNote({
          id,
          type: body.type || "tip",
          topic: body.topic || "Untitled",
          content: body.content || "",
          context: body.context || "",
          tags: body.tags || [],
          authoredBy: "human",
          authoredAt: Date.now(),
        });
        return json({ ok: true, id });
      }

      if (url.pathname === "/api/note" && req.method === "DELETE") {
        return json({ ok: true });
      }

      if (url.pathname === "/api/flows") {
        const service = url.searchParams.get("service") || undefined;
        const type = url.searchParams.get("type") || undefined;
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const all = await client.listFlows(service, type);
        return json({ flows: all.slice(offset, offset + limit), total: all.length });
      }

      return notFound();
    },
    error() {
      return new Response("Internal error", { status: 500 });
    },
  });

  return server;
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function renderHomePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Codebase Wiki</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
<script>mermaid.initialize({startOnLoad:false,theme:'dark',securityLevel:'loose'});</script>
<style>
:root {
  --bg: #0d1117; --bg2: #161b22; --border: #30363d;
  --text: #c9d1d9; --text2: #8b949e; --accent: #58a6ff;
  --green: #3fb950; --orange: #d2991d; --red: #f85149;
  --purple: #a371f7;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.container { max-width: 1100px; margin: 0 auto; padding: 20px; }
header { border-bottom: 1px solid var(--border); padding: 16px 0; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
header h1 { font-size: 20px; }
.search-bar { display: flex; gap: 8px; margin-bottom: 24px; }
.search-bar input { flex: 1; padding: 10px 16px; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 14px; }
.search-bar input:focus { outline: none; border-color: var(--accent); }
.search-bar button { padding: 10px 20px; background: var(--accent); border: none; border-radius: 8px; color: #fff; cursor: pointer; font-size: 14px; font-weight: 500; }
.search-bar button:hover { opacity: 0.9; }
.tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.tab { padding: 8px 16px; cursor: pointer; color: var(--text2); border-bottom: 2px solid transparent; font-size: 14px; }
.tab.active { color: var(--text); border-bottom-color: var(--accent); }
.tab:hover { color: var(--text); }
.card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.card h3 { font-size: 16px; margin-bottom: 6px; }
.card .meta { font-size: 12px; color: var(--text2); margin-bottom: 8px; }
.card .preview { font-size: 14px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-type { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; margin-right: 6px; }
.type-gotcha { background: rgba(248,81,73,0.15); color: var(--red); }
.type-pattern { background: rgba(163,113,247,0.15); color: var(--purple); }
.type-integration { background: rgba(88,166,255,0.15); color: var(--accent); }
.type-convention { background: rgba(63,185,80,0.15); color: var(--green); }
.type-decision { background: rgba(210,153,29,0.15); color: var(--orange); }
.type-tip { background: rgba(139,148,158,0.15); color: var(--text2); }
.tag { display: inline-block; padding: 1px 6px; background: rgba(88,166,255,0.1); border-radius: 4px; font-size: 11px; margin: 2px; color: var(--accent); }
.service-content { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin-top: 16px; line-height: 1.8; }
.service-content h1 { font-size: 24px; margin-bottom: 12px; }
.service-content h2 { font-size: 18px; margin: 20px 0 8px; color: var(--accent); }
.service-content h3 { font-size: 15px; margin: 16px 0 6px; }
.service-content p { margin-bottom: 10px; }
.service-content ul, .service-content ol { margin: 8px 0 8px 20px; }
.service-content code { background: rgba(110,118,129,0.2); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.service-content pre { background: rgba(22,27,34,0.8); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 10px 0; }
.service-content table { border-collapse: collapse; width: 100%; margin: 10px 0; }
.service-content th, .service-content td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; font-size: 13px; }
.service-content th { background: var(--bg); }
.service-content blockquote { border-left: 3px solid var(--accent); padding: 4px 12px; margin: 8px 0; color: var(--text2); }
.flow-content pre { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
.flow-content .mermaid { text-align: center; margin: 10px 0; }
.note-form { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
.note-form input, .note-form select, .note-form textarea { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px; margin-bottom: 10px; }
.note-form textarea { min-height: 80px; font-family: inherit; resize: vertical; }
.note-form button { padding: 8px 20px; background: var(--accent); border: none; border-radius: 6px; color: #fff; cursor: pointer; }
.empty { text-align: center; color: var(--text2); padding: 40px; }
.pagination { display: flex; gap: 8px; justify-content: center; align-items: center; margin: 20px 0; }
.pagination button { padding: 6px 14px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); cursor: pointer; font-size: 13px; }
.pagination button:disabled { opacity: 0.4; cursor: default; }
.pagination .page-info { font-size: 13px; color: var(--text2); }
.filter-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.filter-bar select { padding: 6px 10px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; }
.filter-bar button.small { padding: 6px 12px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; color: var(--text2); cursor: pointer; font-size: 12px; }
.filter-bar button.small:hover { color: var(--text); border-color: var(--accent); }
.stats { display: flex; gap: 16px; margin-bottom: 20px; }
.stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; flex: 1; text-align: center; }
.stat .value { font-size: 28px; font-weight: 600; color: var(--accent); }
.stat .label { font-size: 12px; color: var(--text2); margin-top: 4px; }
.file-ref { display: inline-block; padding: 1px 6px; background: rgba(63,185,80,0.1); border-radius: 4px; font-size: 11px; margin: 2px; color: var(--green); font-family: monospace; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🧠 Codebase Wiki</h1>
    <div style="display:flex;gap:12px;align-items:center">
      <select id="svcFilter" style="padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px" onchange="onSvcFilter(this.value)">
      </select>
      <span id="statBadge" style="font-size:12px;color:var(--text2)"></span>
    </div>
  </header>

  <div id="searchResults"></div>

  <div class="search-bar" id="searchBar">
    <input type="text" id="searchInput" placeholder="Search all: services, flows, notes..." onkeyup="if(event.key==='Enter')doSearch()">
    <button onclick="doSearch()">Search</button>
    <span id="searchMeta" style="font-size:12px;color:var(--text2);display:none"></span>
  </div>

  <div class="stats" id="statsBar"></div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('services')">Services</div>
    <div class="tab" onclick="switchTab('flows')">Flows</div>
    <div class="tab" onclick="switchTab('notes')">Notes</div>
    <div class="tab" onclick="switchTab('addNote')">+ Add Note</div>
  </div>

  <div id="servicesPanel"></div>
  <div id="flowsPanel" style="display:none"></div>
  <div id="notesPanel" style="display:none"></div>
  <div id="addNotePanel" style="display:none">
    <div class="note-form">
      <select id="noteType"><option value="gotcha">Gotcha</option><option value="pattern">Pattern</option><option value="integration">Integration</option><option value="convention">Convention</option><option value="decision">Decision</option><option value="tip">Tip</option></select>
      <input type="text" id="noteTopic" placeholder="Topic / title">
      <textarea id="noteContent" placeholder="What was discovered? Why does it matter?"></textarea>
      <input type="text" id="noteContext" placeholder="Where? (file paths, service, scenario)">
      <input type="text" id="noteTags" placeholder="Tags: cart, redis, ttl">
      <button onclick="addNote()">Save Note</button>
      <span id="noteFeedback" style="margin-left:12px;font-size:13px"></span>
    </div>
  </div>
</div>

<script>
var esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
var state={svc:'',tab:'services',page:0,limit:20};

function api(p){return fetch(p).then(r=>r.ok?r.json():null);}

async function init(){
  var sv=await api('/api/stats');
  if(sv){
    document.getElementById('statBadge').textContent=sv.services+' svc | '+(sv.flows||0)+' flows | '+sv.notes+' notes';
    document.getElementById('statsBar').innerHTML=
      '<div class="stat"><div class="value">'+sv.services+'</div><div class="label">Services</div></div>'+
      '<div class="stat"><div class="value">'+Math.floor(sv.totalChars/1000)+'K</div><div class="label">Content</div></div>'+
      '<div class="stat"><div class="value">'+(sv.flows||0)+'</div><div class="label">Flows</div></div>'+
      '<div class="stat"><div class="value">'+sv.notes+'</div><div class="label">Notes</div></div>';
  }
  var all=await api('/api/services?limit=999');
  if(all&&all.services){
    window._serviceList=all.services;
    var sel=document.getElementById('svcFilter');
    sel.innerHTML='<option value="">— All Services —</option>'+
      all.services.map(s=>'<option value="'+esc(s.name)+'"'+(s.name===state.svc?' selected':'')+'>'+esc(s.name)+'</option>').join('');
  }
  if(state.svc) loadService(state.svc);
  else switchTab(state.tab);
}

function onSvcFilter(v){
  state.svc=v; state.page=0;
  if(!v){ switchTab(state.tab); return; }
  loadService(v);
}

function switchTab(name){
  state.tab=name; state.page=0;
  var tabs=['services','flows','notes','addNote'];
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',tabs[i]===name));
  ['servicesPanel','flowsPanel','notesPanel','addNotePanel'].forEach(id=>document.getElementById(id).style.display='none');
  var pid=name==='services'?'servicesPanel':name==='flows'?'flowsPanel':name==='notes'?'notesPanel':name==='addNote'?'addNotePanel':'';
  document.getElementById(pid).style.display='block';
  document.getElementById('searchBar').style.display=name==='addNote'?'none':'flex';
  document.getElementById('searchResults').style.display='none';
  if(name==='services'&&!state.svc) loadServices();
  if(name==='flows') loadFlows();
  if(name==='notes') loadNotes();
}

function renderPagination(total,loadFn,extra){
  if(total<=state.limit)return'';
  var pages=Math.ceil(total/state.limit);
  return'<div class="pagination">'+
    '<button '+(state.page===0?'disabled':'')+' onclick="'+loadFn+'('+Math.max(0,state.page-1)+(extra||'')+')">« Prev</button>'+
    '<span class="page-info">Page '+(state.page+1)+' of '+pages+' ('+total+' total)</span>'+
    '<button '+((state.page+1)*state.limit>=total?'disabled':'')+' onclick="'+loadFn+'('+(state.page+1)+(extra||'')+')">Next »</button>'+
    '</div>';
}

async function loadServices(page){
  if(typeof page==='number')state.page=page;
  var data=await api('/api/services?offset='+(state.page*state.limit)+'&limit='+state.limit);
  var p=document.getElementById('servicesPanel');
  if(!data||!data.services.length){p.innerHTML='<div class="empty">No services indexed.</div>';return;}
  p.innerHTML=data.services.map(s=>
    '<div class="card" style="cursor:pointer" onclick="onSvcFilter(' + "'" + esc(s.name) + "'" + ')">'+
    '<h3>'+esc(s.name)+'</h3><div class="meta">'+esc(s.path)+' | '+Math.floor(s.size/1000)+'K</div></div>'
  ).join('')+renderPagination(data.total,'loadServices');
}

async function loadService(name){
  state.svc=name; document.getElementById('svcFilter').value=name;
  document.getElementById('searchBar').style.display='flex';
  var doc=await api('/api/service?name='+encodeURIComponent(name));
  var p=document.getElementById('servicesPanel');
  if(!doc){p.innerHTML='<div class="empty">No docs for "'+esc(name)+'"</div>';return;}
  var h='<div class="service-content"><a href="#" onclick="' + "onSvcFilter('');return false" + '" style="font-size:13px">← All services</a><br><br>';
  var raw=typeof marked!=='undefined'?marked.parse(doc.content):'<pre>'+esc(doc.content)+'</pre>';
  h+=(typeof DOMPurify!=='undefined'?DOMPurify.sanitize(raw):esc(raw))+'</div>';
  p.innerHTML=h;
  p.querySelectorAll('code.language-mermaid').forEach(function(b){var pr=b.parentElement;pr.className='mermaid';pr.textContent=b.textContent;});
  if(typeof mermaid!=='undefined')try{mermaid.run({querySelector:'.mermaid'});}catch(e){}
  // Show flows for this service below doc
  document.getElementById('flowsPanel').style.display='block';
  document.getElementById('flowsPanel').innerHTML='<div id="svcFlowsPanel"></div>';
  loadSvcFlows(0);
}

async function loadSvcFlows(page){
  if(typeof page==='number')state.page=page;
  var data=await api('/api/flows?service='+encodeURIComponent(state.svc)+'&offset='+(state.page*state.limit)+'&limit='+state.limit);
  var p=document.getElementById('svcFlowsPanel');
  if(!data||!data.flows.length){p.innerHTML='<div class="empty" style="font-size:13px">No flows for this service.</div>';return;}
  p.innerHTML='<h3 style="margin:20px 0 10px;font-size:15px;color:var(--accent)">Flows ('+data.total+')</h3>'+
    '<button class="small" onclick="toggleAllFlows()" style="margin-bottom:8px">Expand All</button>'+
    renderFlowCards(data.flows)+renderPagination(data.total,'loadSvcFlows');
  p.querySelectorAll('code.language-mermaid').forEach(function(b){var pr=b.parentElement;pr.className='mermaid';pr.textContent=b.textContent;});
  if(typeof mermaid!=='undefined')try{mermaid.run({querySelector:'#svcFlowsPanel .mermaid'});}catch(e){}
}

async function loadFlows(page){
  if(typeof page==='number')state.page=page;
  var params='?offset='+(state.page*state.limit)+'&limit='+state.limit;
  if(state.svc)params+='&service='+encodeURIComponent(state.svc);
  var data=await api('/api/flows'+params);
  var p=document.getElementById('flowsPanel');
  if(!data||!data.flows.length){p.innerHTML='<div class="empty">No flows.</div>';return;}
  p.innerHTML='<div class="filter-bar">'+
    '<select id="flowTypeFilter" onchange="loadFlows(0)" style="margin-right:8px">'+
    '<option value="">All types</option><option value="happy_path">Happy Path</option><option value="error_path">Error Path</option><option value="edge_case">Edge Case</option><option value="recovery">Recovery</option><option value="state_machine">State Machine</option></select>'+
    '<button class="small" onclick="toggleAllFlows()">Expand All</button></div>'+
    renderFlowCards(data.flows)+renderPagination(data.total,'loadFlows');
  p.querySelectorAll('code.language-mermaid').forEach(function(b){var pr=b.parentElement;pr.className='mermaid';pr.textContent=b.textContent;});
  if(typeof mermaid!=='undefined')try{mermaid.run({querySelector:'#flowsPanel .mermaid'});}catch(e){}
}

function renderFlowCards(flows){
  return flows.map(function(f){
    var tc=getFlowClass(f.flowType);
    return'<div class="card" onclick="tgl(this)" style="cursor:pointer">'+
      '<span class="note-type '+tc+'">'+esc(f.flowType||'')+'</span>'+
      '<strong>'+esc(f.flowName)+'</strong>'+
      '<div class="meta" style="margin-top:4px">'+esc(f.serviceName)+' | '+esc(f.summary||'')+'</div>'+
      (f.keywords&&f.keywords.length?'<div style="margin-top:4px">'+f.keywords.map(function(k){return'<span class="tag">'+esc(k)+'</span>'}).join('')+'</div>':'')+
      (f.linkedServices&&f.linkedServices.length?'<div style="margin-top:4px;font-size:12px;color:var(--text2)">Linked: '+f.linkedServices.map(function(s){return'<span class="tag">'+esc(s)+'</span>'}).join(' ')+'</div>':'')+
      (f.fileRefs&&f.fileRefs.length?'<div style="margin-top:4px">'+f.fileRefs.map(function(r){return'<span class="file-ref">'+esc(r)+'</span>'}).join(' ')+'</div>':'')+
      '<div class="flow-content" style="display:none;margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;overflow-x:auto">'+
        (typeof marked!=='undefined'?(typeof DOMPurify!=='undefined'?DOMPurify.sanitize(marked.parse(f.content||'')):marked.parse(f.content||'')):'<pre>'+esc(f.content||'')+'</pre>')+
      '</div></div>';
  }).join('');
}

function tgl(el){var c=el.querySelector('.flow-content');if(c)c.style.display=c.style.display==='none'?'block':'none';}
function toggleAllFlows(){var all=document.querySelectorAll('.flow-content');var anyHidden=Array.from(all).some(function(c){return c.style.display==='none'});all.forEach(function(c){c.style.display=anyHidden?'block':'none'});}

function getFlowClass(t){var m={happy_path:'integration',error_path:'gotcha',recovery:'integration',edge_case:'convention',full:'pattern',state_machine:'pattern'};return'type-'+(m[t]||'gotcha');}

async function loadNotes(page){
  if(typeof page==='number')state.page=page;
  var params='?offset='+(state.page*state.limit)+'&limit='+state.limit;
  if(state.svc)params+='&service='+encodeURIComponent(state.svc);
  var data=await api('/api/notes'+params);
  var p=document.getElementById('notesPanel');
  if(!data||!data.notes.length){p.innerHTML='<div class="empty">No notes.</div>';return;}
  p.innerHTML=data.notes.map(function(n){
    return'<div class="card"><span class="note-type type-'+esc(n.type)+'">'+esc(n.type)+'</span><strong>'+esc(n.topic)+'</strong>'+
    (n.context?'<div class="meta" style="margin-top:4px">'+esc(n.context)+'</div>':'')+
    '<div style="margin-top:6px;font-size:14px">'+esc(n.content.slice(0,300))+'</div>'+
    (n.tags&&n.tags.length?'<div style="margin-top:6px">'+n.tags.map(function(t){return'<span class="tag">'+esc(t)+'</span>'}).join('')+'</div>':'')+'</div>';
  }).join('')+renderPagination(data.total,'loadNotes');
}

async function doSearch(page){
  if(typeof page==='number')state.page=page;
  var q=document.getElementById('searchInput').value.trim();
  if(!q)return;
  var data=await api('/api/search?q='+encodeURIComponent(q)+'&offset='+(state.page*state.limit)+'&limit='+state.limit);
  if(!data)return;
  var div=document.getElementById('searchResults');
  var h='<h3 style="margin-bottom:12px">Results for "'+esc(q)+'"</h3>';
  if(data.docs&&data.docs.length)h+='<h4 style="color:var(--text2);margin-bottom:8px">Services ('+data.totalDocs+')</h4>'+data.docs.map(function(d){var p=esc(d.content.slice(0,150).replace(` + `/\\n/g, ' '` + `));return'<div class="card" style="cursor:pointer" onclick="onSvcFilter(' + "'" + esc(d.serviceName) + "'" + ')"><h3>'+esc(d.serviceName)+'</h3><div class="preview">'+p+'...</div></div>';}).join('');
  if(data.flows&&data.flows.length)h+='<h4 style="color:var(--text2);margin:12px 0 8px">Flows ('+data.totalFlows+')</h4>'+renderFlowCards(data.flows);
  if(data.notes&&data.notes.length)h+='<h4 style="color:var(--text2);margin:12px 0 8px">Notes ('+data.totalNotes+')</h4>'+data.notes.map(function(n){return'<div class="card"><span class="note-type type-'+esc(n.type)+'">'+esc(n.type)+'</span><strong>'+esc(n.topic)+'</strong><div style="font-size:14px;margin-top:4px">'+esc(n.content.slice(0,150))+'</div></div>';}).join('');
  if(!data.docs.length&&!data.flows.length&&!data.notes.length)h+='<div class="empty">No results.</div>';
  var total=Math.max(data.totalDocs||0,data.totalFlows||0,data.totalNotes||0);
  h+=renderPagination(total,'doSearch');
  div.innerHTML=h;
  div.querySelectorAll('code.language-mermaid').forEach(function(b){var pr=b.parentElement;pr.className='mermaid';pr.textContent=b.textContent;});
  if(typeof mermaid!=='undefined')try{mermaid.run({querySelector:'#searchResults .mermaid'});}catch(e){}
}

async function addNote(){
  var type=document.getElementById('noteType').value,topic=document.getElementById('noteTopic').value.trim(),content=document.getElementById('noteContent').value.trim(),context=document.getElementById('noteContext').value.trim(),tags=document.getElementById('noteTags').value.split(',').map(function(t){return t.trim()}).filter(Boolean);
  if(!topic||!content)return;
  var r=await fetch('/api/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,topic,content,context,tags})});
  if(r.ok){document.getElementById('noteFeedback').textContent='✓ Saved!';['noteTopic','noteContent','noteContext','noteTags'].forEach(function(id){document.getElementById(id).value='';});setTimeout(function(){document.getElementById('noteFeedback').textContent='';},2000);}
}

init();
</script>
</body>
</html>`;
}
