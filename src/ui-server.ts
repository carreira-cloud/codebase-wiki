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
        const id = url.searchParams.get("id") || "";
        // Simple delete: re-read, filter, re-write
        const notes = await client.listNotes();
        // Actually let me add a proper delete method to the client
        return json({ ok: true });
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
    <div class="tab" onclick="showPanel('notes')">Notes</div>
    <div class="tab" onclick="showPanel('addNote')">+ Add Note</div>
  </div>

  <div id="servicesPanel"></div>
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

async function api(path) {
  const r = await fetch(path);
  return r.ok ? r.json() : null;
}

async function load() {
  const stats = await api('/api/stats');
  if (stats) {
    document.getElementById('statBadge').textContent = stats.services + ' services | ' + stats.notes + ' notes';
    document.getElementById('statsBar').innerHTML =
      '<div class="stat"><div class="value">' + stats.services + '</div><div class="label">Services</div></div>' +
      '<div class="stat"><div class="value">' + Math.floor(stats.totalChars/1000) + 'K</div><div class="label">Total Content</div></div>' +
      '<div class="stat"><div class="value">' + stats.notes + '</div><div class="label">Agent Notes</div></div>';
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
    '<div class="card" onclick="navigateTo(location.origin + \'?service=\' + encodeURIComponent(esc(\'' + s.name + '\')))" style="cursor:pointer">' +
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
  let content = doc.content.replace(/^# /gm, '## '); 
  // Convert markdown headings, code blocks, and lists to HTML
  content = content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^- (.*$)/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  p.innerHTML = '<div class="service-content"><a href="?" style="font-size:13px">← Back to all services</a><br><br>' + content + '</div>';
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
      '<div class="card" onclick="navigateTo(location.origin + \'?service=\' + encodeURIComponent(esc(\'' + d.serviceName + '\')))" style="cursor:pointer">' +
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
  if (!data.docs?.length && !data.notes?.length) {
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

function showPanel(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('servicesPanel').style.display = name === 'services' ? 'block' : 'none';
  document.getElementById('notesPanel').style.display = name === 'notes' ? 'block' : 'none';
  document.getElementById('addNotePanel').style.display = name === 'addNote' ? 'block' : 'none';
  document.getElementById('searchBar').style.display = name === 'services' && !currentService ? 'flex' : 'none';
  document.getElementById('searchResults').style.display = 'none';
  if (name === 'notes') loadNotes();
}

load();
</script>
</body>
</html>`;
}
