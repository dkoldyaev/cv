const express = require('express');
const { marked } = require('marked');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { extractTitleAndJsonLd, renderCvHtml, escapeHtml } = require('./renderer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize root CV in database if not present or migrate existing layout
function initializeRootCv() {
  const existing = db.prepare('SELECT id, markdown FROM pages WHERE id = ?').get('root');
  const cvMdPath = path.join(__dirname, 'cv.md');
  let mdContent = '';
  if (fs.existsSync(cvMdPath)) {
    mdContent = fs.readFileSync(cvMdPath, 'utf8');
  } else {
    mdContent = '# Dmitry Koldyaev\n## Frontend Developer\n\nWelcome to my CV.';
  }

  // Always sync root page with current markdown & layout renderer on startup
  const contentToUse = existing && existing.markdown ? existing.markdown : mdContent;
  const { title, jsonLd } = extractTitleAndJsonLd(contentToUse);
  const fullHtml = renderCvHtml({
    markdown: contentToUse,
    title,
    jsonLd,
    rawMdUrl: '/cv.md',
    editUrl: '/admin',
    id: 'root'
  });

  db.prepare(`
    INSERT INTO pages (id, title, markdown, html, json_ld, created_at, updated_at)
    VALUES ('root', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      html = excluded.html,
      json_ld = excluded.json_ld,
      updated_at = CURRENT_TIMESTAMP
  `).run(title, contentToUse, fullHtml, JSON.stringify(jsonLd));
  console.log('Root CV initialized/updated successfully in SQLite database.');
}
initializeRootCv();

// Basic Cookie/Header Auth Helper for Admin
function checkAuth(req, res, next) {
  // Check cookie or auth header or query param
  const authHeader = req.headers['authorization'];
  let pass = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    pass = authHeader.substring(7);
  } else if (req.query.token) {
    pass = req.query.token;
  } else {
    const cookies = req.headers.cookie ? req.headers.cookie.split(';') : [];
    for (const c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'admin_auth') pass = decodeURIComponent(v);
    }
  }

  if (pass === ADMIN_PASSWORD) {
    req.isAuthenticated = true;
    return next();
  }

  // If API request, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized. Provide valid Bearer token or ADMIN_PASSWORD.' });
  }

  // If web admin, render login page
  return res.send(renderLoginPage());
}

function renderLoginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CV Admin Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f7fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: white; padding: 32px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.1); width: 100%; max-width: 360px; }
    h2 { margin-top: 0; color: #2d3748; }
    label { font-size: 0.875rem; color: #4a5568; font-weight: 500; display: block; margin-bottom: 6px; }
    input[type="password"] { width: 100%; padding: 10px 12px; box-sizing: border-box; border: 1px solid #cbd5e0; border-radius: 6px; margin-bottom: 16px; font-size: 1rem; }
    button { width: 100%; background: #3182ce; color: white; border: none; padding: 10px; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #2b6cb0; }
    .error { color: #e53e3e; font-size: 0.875rem; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>CV Admin Login</h2>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/admin/login">
      <label for="password">Admin Password</label>
      <input type="password" id="password" name="password" required autofocus />
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;
}

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------

// 1. Root CV (HTML)
app.get('/', (req, res) => {
  const row = db.prepare('SELECT html FROM pages WHERE id = ?').get('root');
  if (!row) {
    return res.status(404).send('CV Not Found');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(row.html);
});

// 2. Original / Legacy HTML static view
app.get('/legacy', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.redirect('/');
  }
});

// 3. Root CV Markdown format
app.get(['/cv.md', '/raw', '/index.md'], (req, res) => {
  const row = db.prepare('SELECT markdown FROM pages WHERE id = ?').get('root');
  if (!row) {
    return res.status(404).send('CV Not Found');
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(row.markdown);
});

// 4. View any CV page by unique link /cv/:id
app.get('/cv/:id', (req, res) => {
  const row = db.prepare('SELECT html FROM pages WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).send('<!DOCTYPE html><html><head><title>Not Found</title></head><body><h1>404 Not Found</h1><p>The requested CV version was not found.</p><p><a href="/">Return to Main CV</a></p></body></html>');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(row.html);
});

// 5. View any CV page markdown /cv/:id/md
app.get('/cv/:id/md', (req, res) => {
  const row = db.prepare('SELECT markdown FROM pages WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).send('CV version not found');
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(row.markdown);
});

// 6. JSON-LD direct endpoint for any CV /cv/:id/jsonld
app.get('/cv/:id/jsonld', (req, res) => {
  const id = req.params.id === 'root' || req.params.id === 'main' ? 'root' : req.params.id;
  const row = db.prepare('SELECT json_ld FROM pages WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'CV not found' });
  }
  res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
  res.send(row.json_ld || '{}');
});

app.get('/jsonld', (req, res) => {
  const row = db.prepare('SELECT json_ld FROM pages WHERE id = ?').get('root');
  res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
  res.send(row?.json_ld || '{}');
});

// 7. Endpoint to post new markdown and generate a new CV with a unique URL
// Accepts JSON: { "markdown": "..." } or raw text body
app.post('/api/cv', express.text({ type: ['text/markdown', 'text/plain'] }), (req, res) => {
  let markdown = '';
  if (typeof req.body === 'string') {
    markdown = req.body;
  } else if (req.body && req.body.markdown) {
    markdown = req.body.markdown;
  }

  if (!markdown || !markdown.trim()) {
    return res.status(400).json({ error: 'Missing markdown content. Send {"markdown": "# ..."} or raw text.' });
  }

  const id = crypto.randomBytes(6).toString('hex');
  const { title, jsonLd } = extractTitleAndJsonLd(markdown);
  const fullHtml = renderCvHtml({
    markdown,
    title,
    jsonLd,
    rawMdUrl: `/cv/${id}/md`,
    editUrl: `/admin?edit=${id}`,
    id
  });

  db.prepare(`
    INSERT INTO pages (id, title, markdown, html, json_ld, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, title, markdown, fullHtml, JSON.stringify(jsonLd));

  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const baseUrl = `${proto}://${host}`;

  return res.status(201).json({
    id,
    title,
    url: `${baseUrl}/cv/${id}`,
    markdownUrl: `${baseUrl}/cv/${id}/md`,
    jsonLdUrl: `${baseUrl}/cv/${id}/jsonld`,
    createdAt: new Date().toISOString()
  });
});

// -------------------------------------------------------------
// ADMIN PANEL
// -------------------------------------------------------------

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.setHeader('Set-Cookie', `admin_auth=${encodeURIComponent(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=864000`);
    return res.redirect('/admin');
  }
  return res.status(401).send(renderLoginPage('Invalid password. Please try again.'));
});

app.get('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `admin_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  return res.redirect('/admin');
});

app.get('/admin', checkAuth, (req, res) => {
  const editId = req.query.edit || 'root';
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(editId) || db.prepare('SELECT * FROM pages WHERE id = ?').get('root');
  const allPages = db.prepare('SELECT id, title, created_at, updated_at FROM pages ORDER BY created_at DESC').all();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CV Admin Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; color: #2d3748; }
    header { background: #2d3748; color: white; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
    header h1 { font-size: 1.25rem; margin: 0; }
    header .nav a { color: #edf2f7; text-decoration: none; margin-left: 16px; font-size: 0.9rem; }
    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 56px); }
    aside { background: #edf2f7; border-right: 1px solid #e2e8f0; padding: 20px; }
    aside h2 { font-size: 0.9rem; text-transform: uppercase; color: #718096; letter-spacing: 0.05em; margin-top: 0; }
    .page-list { list-style: none; padding: 0; margin: 0; }
    .page-item { margin-bottom: 8px; }
    .page-item a { display: block; padding: 8px 12px; border-radius: 6px; text-decoration: none; color: #2d3748; font-size: 0.9rem; background: #fff; border: 1px solid #e2e8f0; }
    .page-item a.active { background: #3182ce; color: #fff; border-color: #3182ce; }
    .page-item a small { display: block; font-size: 0.75rem; opacity: 0.8; }
    main { padding: 24px 32px; background: white; }
    .editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .btn { padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; text-decoration: none; font-size: 0.9rem; border: none; }
    .btn-primary { background: #3182ce; color: white; }
    .btn-primary:hover { background: #2b6cb0; }
    .btn-success { background: #38a169; color: white; }
    .btn-danger { background: #e53e3e; color: white; }
    .btn-secondary { background: #e2e8f0; color: #4a5568; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    .tab { padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; background: #f1f5f9; border: 1px solid #e2e8f0; }
    .tab.active { background: #3182ce; color: white; border-color: #3182ce; }
    textarea { width: 100%; height: 500px; font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-size: 0.95rem; padding: 14px; border: 1px solid #cbd5e0; border-radius: 6px; resize: vertical; line-height: 1.5; }
    .preview-box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; background: #fafafa; min-height: 500px; }
    .api-docs { background: #ebf8ff; border: 1px solid #bee3f8; border-radius: 6px; padding: 16px; margin-top: 32px; font-size: 0.88rem; }
    .api-docs code { background: #bee3f8; padding: 2px 5px; border-radius: 4px; }
    .alert { padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 0.9rem; }
    .alert-success { background: #c6f6d5; color: #22543d; border: 1px solid #9ae6b4; }
  </style>
</head>
<body>
  <header>
    <h1>CV Management Admin</h1>
    <div class="nav">
      <a href="/" target="_blank">🌐 View Live Main CV</a>
      <a href="/cv.md" target="_blank">📄 Live Markdown</a>
      <a href="/admin/logout">🚪 Log Out</a>
    </div>
  </header>
  <div class="layout">
    <aside>
      <h2>Versions & Pages</h2>
      <ul class="page-list">
        ${allPages.map(p => `
          <li class="page-item">
            <a href="/admin?edit=${p.id}" class="${p.id === page.id ? 'active' : ''}">
              <strong>${p.id === 'root' ? '⭐️ Main CV (Root)' : escapeHtml(p.title || p.id)}</strong>
              <small>ID: ${p.id} &bull; ${new Date(p.updated_at).toLocaleDateString()}</small>
            </a>
          </li>
        `).join('')}
      </ul>
      <div style="margin-top: 20px;">
        <button class="btn btn-secondary" style="width: 100%;" onclick="createNew()">+ Create New Blank Page</button>
      </div>
    </aside>
    <main>
      <div class="editor-header">
        <div>
          <h2>Editing: ${page.id === 'root' ? '⭐️ Main CV (/)' : page.id}</h2>
          <div style="font-size: 0.85rem; color: #718096;">
            Public URL: <a href="${page.id === 'root' ? '/' : `/cv/${page.id}`}" target="_blank">${page.id === 'root' ? '/' : `/cv/${page.id}`}</a> |
            Markdown: <a href="${page.id === 'root' ? '/cv.md' : `/cv/${page.id}/md`}" target="_blank">View Raw .md</a> |
            JSON-LD: <a href="${page.id === 'root' ? '/jsonld' : `/cv/${page.id}/jsonld`}" target="_blank">View JSON-LD</a>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          ${page.id !== 'root' ? `<button class="btn btn-danger" onclick="deletePage('${page.id}')">Delete</button>` : ''}
          <button class="btn btn-success" onclick="saveCv()">Save Changes</button>
        </div>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="showTab('editor')">Markdown Editor</div>
        <div class="tab" onclick="showTab('preview')">Preview</div>
        <div class="tab" onclick="showTab('jsonld')">JSON-LD Metadata</div>
      </div>

      <div id="tab-editor">
        <textarea id="markdown-input">${escapeHtml(page.markdown)}</textarea>
      </div>

      <div id="tab-preview" style="display: none;">
        <div class="preview-box" id="preview-content">Loading...</div>
      </div>

      <div id="tab-jsonld" style="display: none;">
        <p style="font-size: 0.9rem; color: #4a5568;">This JSON-LD metadata is automatically embedded in <code>&lt;script type="application/ld+json"&gt;</code> in the generated HTML page.</p>
        <pre><code id="jsonld-content" style="display:block; padding:16px; background:#2d3748; color:#f7fafc; border-radius:6px; font-size:0.9rem;">${escapeHtml(page.json_ld)}</code></pre>
      </div>

      <div class="api-docs">
        <strong>⚡ Markdown to Unique HTML API:</strong>
        <p>Send a POST request with new Markdown to receive a newly rendered HTML page with a unique URL:</p>
        <pre style="background:#2d3748; color:#edf2f7; padding:10px; border-radius:4px; overflow-x:auto;"><code>curl -X POST https://${req.get('host')}/api/cv \\
  -H "Content-Type: application/json" \\
  -d '{"markdown": "# Dmitry Koldyaev\\n## Frontend Developer\\n\\nNew version details..."}'</code></pre>
        Response: <code>{"id": "...", "url": "https://${req.get('host')}/cv/...", "markdownUrl": "...", "jsonLdUrl": "..."}</code>
      </div>
    </main>
  </div>

  <script>
    const currentId = "${page.id}";

    function showTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-editor').style.display = name === 'editor' ? 'block' : 'none';
      document.getElementById('tab-preview').style.display = name === 'preview' ? 'block' : 'none';
      document.getElementById('tab-jsonld').style.display = name === 'jsonld' ? 'block' : 'none';

      if (name === 'preview') {
        renderPreview();
      }
    }

    async function renderPreview() {
      const md = document.getElementById('markdown-input').value;
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: md })
      });
      const data = await res.json();
      document.getElementById('preview-content').innerHTML = data.html;
      document.getElementById('jsonld-content').textContent = JSON.stringify(data.jsonLd, null, 2);
    }

    async function saveCv() {
      const md = document.getElementById('markdown-input').value;
      const res = await fetch('/admin/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentId, markdown: md })
      });
      if (res.ok) {
        alert('CV saved successfully!');
        window.location.reload();
      } else {
        alert('Error saving CV');
      }
    }

    function createNew() {
      const initialMd = "# New CV Version\\n## Role / Title\\n\\nDescribe yourself or paste CV markdown here...";
      fetch('/api/cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: initialMd })
      })
      .then(res => res.json())
      .then(data => {
        window.location.href = '/admin?edit=' + data.id;
      });
    }

    async function deletePage(id) {
      if (confirm('Are you sure you want to delete this page?')) {
        const res = await fetch('/admin/delete?id=' + id, { method: 'POST' });
        if (res.ok) {
          window.location.href = '/admin';
        } else {
          alert('Error deleting page');
        }
      }
    }
  </script>
</body>
</html>`;

  res.send(html);
});

// Admin save action
app.post('/admin/save', checkAuth, (req, res) => {
  const { id, markdown } = req.body;
  if (!markdown) {
    return res.status(400).json({ error: 'Markdown content required' });
  }

  const { title, jsonLd } = extractTitleAndJsonLd(markdown);
  const fullHtml = renderCvHtml({
    markdown,
    title,
    jsonLd,
    rawMdUrl: id === 'root' ? '/cv.md' : `/cv/${id}/md`,
    editUrl: `/admin?edit=${id}`,
    id
  });

  db.prepare(`
    INSERT INTO pages (id, title, markdown, html, json_ld, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      markdown = excluded.markdown,
      html = excluded.html,
      json_ld = excluded.json_ld,
      updated_at = CURRENT_TIMESTAMP
  `).run(id || 'root', title, markdown, fullHtml, JSON.stringify(jsonLd));

  return res.json({ success: true, id, title });
});

// Admin delete action
app.post('/admin/delete', checkAuth, (req, res) => {
  const id = req.query.id;
  if (!id || id === 'root') {
    return res.status(400).json({ error: 'Cannot delete root page' });
  }
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
  res.json({ success: true });
});

// Admin live preview API
app.post('/api/preview', (req, res) => {
  const { markdown } = req.body;
  const { title, jsonLd } = extractTitleAndJsonLd(markdown || '');
  const html = renderCvHtml({
    markdown: markdown || '',
    title,
    jsonLd
  });
  res.json({ title, html, jsonLd });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CV Server running on http://0.0.0.0:${PORT}`);
});
