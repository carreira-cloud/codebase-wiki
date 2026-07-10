import { join } from "node:path";
import { getClient } from "./lancedb/client";
import type { WikiDoc, WikiNote } from "./types";

export async function startUIServer(port: number, dbPath: string) {
  const client = getClient(dbPath);
  await client.connect();

  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === "/") return html(renderHomePage());

      if (url.pathname === "/api/services") {
        const services = await client.listServices();
        return json(services);
      }

      if (url.pathname === "/api/service") {
        const name = url.searchParams.get("name") || "";
        const doc = await client.getDoc(name);
        return doc ? json(doc) : notFound();
      }

      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") || "";
        const docs = await client.searchDocs(q);
        const notes = await client.searchNotes(q);
        return json({ docs, notes });
      }

      if (url.pathname === "/api/notes") {
        const type = url.searchParams.get("type") || undefined;
        const notes = await client.listNotes(type);
        return json(notes);
      }

      if (url.pathname === "/api/stats") {
        const stats = await client.stats();
        return json(stats);
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
        const flows = await client.listFlows(service, type);
        return json(flows);
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
.stats { display: flex; gap: 16px; margin-bottom: 20px; }
.stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; flex: 1; text-align: center; }
.stat .value { font-size: 28px; font-weight: 600; color: var(--accent); }
.stat .label { font-size: 12px; color: var(--text2); margin-top: 4px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🧠 Codebase Wiki</h1>
    <div style="display:flex;gap:12px;align-items:center">
      <select id="serviceSelect" style="padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px" onchange="navigateTo(location.origin + '?service=' + this.value)">
      </select>
      <span id="statBadge" style="font-size:12px;color:var(--text2)"></span>
    </div>
  </header>

  <div id="searchResults"></div>

  <div class="search-bar" id="searchBar">
    <input type="text" id="searchInput" placeholder="Search services, documentation, notes..." onkeyup="if(event.key==='Enter')search()">
    <button onclick="search()">Search</button>
  </div>

  <div class="stats" id="statsBar"></div>

  <div class="tabs">
    <div class="tab active" onclick="showPanel('services')">Services</div>
    <div class="tab" onclick="showPanel('flows')">Flows</div>
    <div class="tab" onclick="showPanel('notes')">Notes</div>
    <div class="tab" onclick="showPanel('addNote')">+ Add Note</div>
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
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
let currentService = new URLSearchParams(location.search).get('service') || '';

function clickCard(el) {
  navigateTo(location.origin + '?service=' + encodeURIComponent(el.getAttribute('data-service')));
}

async function api(path) {
  const r = await fetch(path);
  return r.ok ? r.json() : null;
}

async function load() {
  const stats = await api('/api/stats');
  if (stats) {
    document.getElementById('statBadge').textContent = stats.services + ' services | ' + (stats.flows||0) + ' flows | ' + stats.notes + ' notes';
    document.getElementById('statsBar').innerHTML =
      '<div class="stat"><div class="value">' + stats.services + '</div><div class="label">Services</div></div>' +
      '<div class="stat"><div class="value">' + Math.floor(stats.totalChars/1000) + 'K</div><div class="label">Content</div></div>' +
      '<div class="stat"><div class="value">' + (stats.flows||0) + '</div><div class="label">Flows</div></div>' +
      '<div class="stat"><div class="value">' + stats.notes + '</div><div class="label">Notes</div></div>';
  }

  if (currentService) {
    loadService(currentService);
  } else {
    loadServices();
  }

  const services = await api('/api/services');
  if (services) {
    const sel = document.getElementById('serviceSelect');
    sel.innerHTML = '<option value="">— All Services —</option>' +
      services.map(s => '<option value="' + s.name + '"' + (s.name === currentService ? ' selected' : '') + '>' + s.name + '</option>').join('');
  }
}

function navigateTo(url) {
  const u = new URL(url);
  currentService = u.searchParams.get('service') || '';
  window.history.pushState({}, '', url);
  load();
}

async function loadServices() {
  const services = await api('/api/services');
  const p = document.getElementById('servicesPanel');
  if (!services || services.length === 0) {
    p.innerHTML = '<div class="empty">No services indexed yet.<br><br>Run <code>/wiki generate</code> in your agent to create documentation.</div>';
    return;
  }
  p.innerHTML = services.map(s =>
    '<div class="card" data-service="' + esc(s.name) + '" onclick="clickCard(this)" style="cursor:pointer">' +
    '<h3>' + esc(s.name) + '</h3>' +
    '<div class="meta">' + esc(s.path) + ' | ' + Math.floor(s.size/1000) + 'K chars</div>' +
    '</div>'
  ).join('');
}

async function loadService(name) {
  document.getElementById('searchBar').style.display = 'none';
  const doc = await api('/api/service?name=' + encodeURIComponent(name));
  const p = document.getElementById('servicesPanel');
  if (!doc) {
    p.innerHTML = '<div class="empty">Documentation not found for "' + esc(name) + '"</div>';
    return;
  }
  var html = '<div class="service-content"><a href="?" style="font-size:13px">← Back to all services</a><br><br>';
  if (typeof marked !== 'undefined') {
    html += marked.parse(doc.content);
  } else {
    html += '<pre>' + esc(doc.content) + '</pre>';
  }
  html += '</div>';
  p.innerHTML = html;
  // Fix mermaid blocks: marked wraps them in <code>, mermaid needs <pre class="mermaid">
  var blocks = p.querySelectorAll('code.language-mermaid');
  blocks.forEach(function(b) {
    var pre = b.parentElement;
    pre.className = 'mermaid';
    pre.innerHTML = b.textContent;
  });
  if (typeof mermaid !== 'undefined') { try { mermaid.run({querySelector:'.mermaid'}); } catch(e) {} }
}

function toggleFlow(el) {
  var content = el.querySelector('.flow-content');
  if (content) content.style.display = content.style.display === 'none' ? 'block' : 'none';
}

async function loadFlows() {
  var flows = await api('/api/flows');
  var p = document.getElementById('flowsPanel');
  if (!flows || flows.length === 0) {
    p.innerHTML = '<div class="empty">No flows indexed yet.<br><br>Run <code>/wiki discover-flows</code> to discover and index workflows.</div>';
    return;
  }
  p.innerHTML = flows.map(function(f) {
    var typeClass = getFlowClass(f.flowType);
    return '<div class="card" onclick="toggleFlow(this)" style="cursor:pointer">' +
      '<span class="note-type ' + typeClass + '">' + esc(f.flowType || '') + '</span>' +
      '<strong>' + esc(f.flowName) + '</strong>' +
      '<div class="meta" style="margin-top:4px">' + esc(f.serviceName) + ' | ' + esc(f.summary || '') + '</div>' +
      (f.keywords && f.keywords.length ? '<div style="margin-top:4px">' + f.keywords.map(function(k){return '<span class="tag">'+esc(k)+'</span>'}).join('') + '</div>' : '') +
      (f.linkedServices && f.linkedServices.length ? '<div style="margin-top:4px;font-size:12px;color:var(--text2)">Linked: ' + f.linkedServices.map(function(s){return '<span class="tag">'+esc(s)+'</span>'}).join(' ') + '</div>' : '') +
      '<div class="flow-content" style="display:none;margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;overflow-x:auto">' +
        (typeof marked !== 'undefined' ? marked.parse(f.content||'') : '<pre>'+esc(f.content||'')+'</pre>') +
      '</div>' +
    '</div>';
  }).join('');
  // Fix and render mermaid blocks in flows
  var blocks = p.querySelectorAll('code.language-mermaid');
  blocks.forEach(function(b) {
    var pre = b.parentElement;
    pre.className = 'mermaid';
    pre.innerHTML = b.textContent;
  });
  if (typeof mermaid !== 'undefined') { try { mermaid.run({querySelector:'#flowsPanel .mermaid'}); } catch(e) {} }
}

function getFlowClass(type) {
  var map = { happy_path:'integrat', error_path:'gotcha', recovery:'integrat', edge_case:'convent', full:'pattern' };
  return 'type-' + (map[type] || 'gotcha');
}

async function loadNotes() {
  const notes = await api('/api/notes');
  const p = document.getElementById('notesPanel');
  if (!notes || notes.length === 0) {
    p.innerHTML = '<div class="empty">No notes yet. Agents automatically add notes when they discover something new.</div>';
    return;
  }
  p.innerHTML = notes.map(n =>
    '<div class="card">' +
    '<span class="note-type type-' + esc(n.type) + '">' + esc(n.type) + '</span>' +
    '<strong>' + esc(n.topic) + '</strong>' +
    (n.context ? '<div class="meta" style="margin-top:4px">' + esc(n.context) + '</div>' : '') +
    '<div style="margin-top:6px;font-size:14px">' + esc(n.content.slice(0, 300)) + '</div>' +
    (n.tags && n.tags.length ? '<div style="margin-top:6px">' + n.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
    '</div>'
  ).join('');
}

async function search() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  const data = await api('/api/search?q=' + encodeURIComponent(q));
  if (!data) return;
  const div = document.getElementById('searchResults');
  let html = '<h3 style="margin-bottom:12px">Results for "' + esc(q) + '"</h3>';
  if (data.docs && data.docs.length) {
    html += '<h4 style="color:var(--text2);margin-bottom:8px">Services</h4>';
    html += data.docs.map(d =>
      '<div class="card" data-service="' + esc(d.serviceName) + '" onclick="clickCard(this)" style="cursor:pointer">' +
      '<h3>' + esc(d.serviceName) + '</h3>' +
      '<div class="preview">' + esc(d.content.slice(0, 150).replace(/\\n/g, ' ')) + '...</div>' +
      '</div>'
    ).join('');
  }
  if (data.notes && data.notes.length) {
    html += '<h4 style="color:var(--text2);margin:12px 0 8px">Notes</h4>';
    html += data.notes.map(n =>
      '<div class="card"><span class="note-type type-' + esc(n.type) + '">' + esc(n.type) + '</span><strong>' + esc(n.topic) + '</strong>' +
      '<div style="font-size:14px;margin-top:4px">' + esc(n.content.slice(0, 150)) + '</div></div>'
    ).join('');
  }
  var flows = await api('/api/flows');
  if (flows && flows.length) {
    var matches = flows.filter(function(f){ return (f.flowName||'').toLowerCase().indexOf(q) >= 0 || (f.summary||'').toLowerCase().indexOf(q) >= 0 || (f.keywords||[]).some(function(k){return k.toLowerCase().indexOf(q)>=0}) || (f.serviceName||'').toLowerCase().indexOf(q) >= 0; });
    if (matches.length) {
      html += '<h4 style="color:var(--text2);margin:12px 0 8px">Flows (' + matches.length + ')</h4>';
      html += matches.slice(0,10).map(function(f){
        return '<div class="card"><span class="note-type type-integration">' + esc(f.flowType) + '</span><strong>' + esc(f.flowName) + '</strong>' +
          ' <span style="font-size:12px;color:var(--text2)">(' + esc(f.serviceName) + ')</span>' +
          '<div style="font-size:14px;margin-top:4px">' + esc(f.summary||'') + '</div></div>';
      }).join('');
    }
  }
  if (!data.docs?.length && !data.notes?.length && !(flows&&matches&&matches.length)) {
    html += '<div class="empty">No results found.</div>';
  }
  div.innerHTML = html;
  div.style.display = 'block';
}

async function addNote() {
  const type = document.getElementById('noteType').value;
  const topic = document.getElementById('noteTopic').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  const context = document.getElementById('noteContext').value.trim();
  const tags = document.getElementById('noteTags').value.split(',').map(t => t.trim()).filter(Boolean);
  if (!topic || !content) return;

  const r = await fetch('/api/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, topic, content, context, tags })
  });
  if (r.ok) {
    document.getElementById('noteFeedback').textContent = '✓ Saved!';
    document.getElementById('noteTopic').value = '';
    document.getElementById('noteContent').value = '';
    document.getElementById('noteContext').value = '';
    document.getElementById('noteTags').value = '';
    setTimeout(() => document.getElementById('noteFeedback').textContent = '', 2000);
  }
}

function showPanel(name, evt) {
  var tabs = ['services','flows','notes','addNote'];
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', i === tabs.indexOf(name));
  });
  document.getElementById('servicesPanel').style.display = name === 'services' ? 'block' : 'none';
  document.getElementById('flowsPanel').style.display = name === 'flows' ? 'block' : 'none';
  document.getElementById('notesPanel').style.display = name === 'notes' ? 'block' : 'none';
  document.getElementById('addNotePanel').style.display = name === 'addNote' ? 'block' : 'none';
  document.getElementById('searchBar').style.display = (name === 'services' || name === 'flows') && !currentService ? 'flex' : 'none';
  document.getElementById('searchResults').style.display = 'none';
  if (name === 'notes') loadNotes();
  if (name === 'flows') loadFlows();
}

load();
</script>
</body>
</html>`;
}
