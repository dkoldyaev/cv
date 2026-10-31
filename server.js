const express = require('express');
const { marked } = require('marked');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const db = require('./database');
const { extractTitleAndJsonLd, renderCvHtml, escapeHtml } = require('./renderer');
const { jsonToMarkdown } = require('./converter');
const { generatePdfFromHtml } = require('./pdf');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// Initialize JSON Schema validator
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const schemaPath = path.join(__dirname, 'schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validateCvJson = ajv.compile(schema);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Helper to generate API tokens
function createApiToken(name = 'default') {
  const token = 'cvt_' + crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO api_tokens (token, name, created_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(token, name);
  return token;
}

// Ensure at least one default API token exists
function ensureDefaultApiToken() {
  const existing = db.prepare('SELECT token FROM api_tokens LIMIT 1').get();
  if (!existing) {
    const token = createApiToken('Default API Token');
    console.log(`Initial API Token generated: ${token}`);
  }
}
ensureDefaultApiToken();

// Auth helper for Bearer token (API)
function checkApiToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-api-key']) {
    token = req.headers['x-api-key'];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing API Token. Use Authorization: Bearer <token> or ?token=<token>' });
  }

  // Allow ADMIN_PASSWORD as fallback token
  if (token === ADMIN_PASSWORD) {
    return next();
  }

  const row = db.prepare('SELECT token, name FROM api_tokens WHERE token = ?').get(token);
  if (!row) {
    return res.status(401).json({ error: 'Invalid API Token.' });
  }

  // Update last used
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?').run(token);
  req.apiToken = row;
  next();
}

// Cookie/Header Auth Helper for Admin UI
function checkAdminAuth(req, res, next) {
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

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

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

// Initialize root CV in database if not present or migrate existing layout
function initializeRootCv() {
  const existing = db.prepare('SELECT id, markdown, json_data FROM pages WHERE id = ?').get('root');
  const cvJsonPath = path.join(__dirname, 'cv.json');
  const cvMdPath = path.join(__dirname, 'cv.md');

  let jsonDataStr = '';
  let mdContent = '';

  if (fs.existsSync(cvJsonPath)) {
    jsonDataStr = fs.readFileSync(cvJsonPath, 'utf8');
    const jsonParsed = JSON.parse(jsonDataStr);
    mdContent = jsonToMarkdown(jsonParsed);
  } else if (fs.existsSync(cvMdPath)) {
    mdContent = fs.readFileSync(cvMdPath, 'utf8');
  }

  const contentToUse = existing && existing.markdown ? existing.markdown : mdContent;
  const jsonToUse = existing && existing.json_data ? existing.json_data : jsonDataStr;

  const { title, jsonLd } = extractTitleAndJsonLd(contentToUse);
  const fullHtml = renderCvHtml({
    markdown: contentToUse,
    title,
    jsonLd,
    rawMdUrl: '/cv.md',
    pdfUrl: '/cv.pdf',
    jsonUrl: '/cv.json',
    editUrl: '/admin',
    id: 'root',
    showAdmin: false
  });

  db.prepare(`
    INSERT INTO pages (id, title, markdown, html, json_ld, json_data, created_at, updated_at)
    VALUES ('root', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      html = excluded.html,
      json_ld = excluded.json_ld,
      json_data = excluded.json_data,
      updated_at = CURRENT_TIMESTAMP
  `).run(title, contentToUse, fullHtml, JSON.stringify(jsonLd), jsonToUse);
  console.log('Root CV initialized/updated successfully in SQLite database.');
}
initializeRootCv();

// -------------------------------------------------------------
// PUBLIC CV ROUTES
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

// Original / Legacy HTML static view
app.get('/legacy', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.redirect('/');
  }
});

// Root Markdown, JSON, PDF
app.get(['/cv.md', '/raw', '/index.md'], (req, res) => {
  const row = db.prepare('SELECT markdown FROM pages WHERE id = ?').get('root');
  if (!row) return res.status(404).send('CV Not Found');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(row.markdown);
});

app.get(['/cv.json', '/root.json'], (req, res) => {
  const row = db.prepare('SELECT json_data FROM pages WHERE id = ?').get('root');
  if (!row || !row.json_data) return res.status(404).json({ error: 'CV JSON not found' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(row.json_data);
});

app.get('/cv.pdf', async (req, res) => {
  serveCvPdf('root', req, res);
});

// JSON-LD direct endpoint
app.get('/jsonld', (req, res) => {
  const row = db.prepare('SELECT json_ld FROM pages WHERE id = ?').get('root');
  res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
  res.send(row?.json_ld || '{}');
});

// JSON Schema endpoint
app.get(['/schema.json', '/api/schema'], (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(schema, null, 2));
});

// -------------------------------------------------------------
// DYNAMIC CV ROUTES BY UUID: /:id, /:id.md, /:id.json, /:id.pdf
// -------------------------------------------------------------

// Lazy PDF generation helper
async function serveCvPdf(id, req, res) {
  const row = db.prepare('SELECT html, pdf_blob FROM pages WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).send('CV version not found');
  }

  // Return cached PDF if already generated
  if (row.pdf_blob) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cv-${id}.pdf"`);
    return res.send(row.pdf_blob);
  }

  try {
    console.log(`Lazy generating PDF for CV [${id}]...`);
    const pdfBuffer = await generatePdfFromHtml(row.html);

    // Cache in DB for future requests
    db.prepare('UPDATE pages SET pdf_blob = ? WHERE id = ?').run(pdfBuffer, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cv-${id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    return res.status(500).send('Error generating PDF');
  }
}

// 1. UUID HTML page
app.get('/:id', (req, res, next) => {
  const id = req.params.id;
  // Ignore favicon and admin routes
  if (id === 'favicon.ico' || id === 'admin' || id === 'api' || id === 'cv' || id === 'jsonld' || id === 'legacy') {
    return next();
  }

  const row = db.prepare('SELECT html FROM pages WHERE id = ?').get(id);
  if (!row) {
    return next();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(row.html);
});

// 2. UUID.md
app.get('/:id.md', (req, res, next) => {
  const id = req.params.id;
  const row = db.prepare('SELECT markdown FROM pages WHERE id = ?').get(id);
  if (!row) return next();
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(row.markdown);
});

// 3. UUID.json
app.get('/:id.json', (req, res, next) => {
  const id = req.params.id;
  const row = db.prepare('SELECT json_data FROM pages WHERE id = ?').get(id);
  if (!row || !row.json_data) return next();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(row.json_data);
});

// 4. UUID.pdf
app.get('/:id.pdf', async (req, res, next) => {
  const id = req.params.id;
  const exists = db.prepare('SELECT id FROM pages WHERE id = ?').get(id);
  if (!exists) return next();
  await serveCvPdf(id, req, res);
});

// Legacy /cv/:id backwards compatibility
app.get('/cv/:id', (req, res) => {
  res.redirect(`/${req.params.id}`);
});
app.get('/cv/:id/md', (req, res) => {
  res.redirect(`/${req.params.id}.md`);
});
app.get('/cv/:id/json', (req, res) => {
  res.redirect(`/${req.params.id}.json`);
});
app.get('/cv/:id/pdf', (req, res) => {
  res.redirect(`/${req.params.id}.pdf`);
});
app.get('/cv/:id/jsonld', (req, res) => {
  const row = db.prepare('SELECT json_ld FROM pages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'CV not found' });
  res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
  res.send(row.json_ld || '{}');
});

// -------------------------------------------------------------
// POST /api/cv - CREATE NEW CV FROM JSON (Validated with JSON Schema)
// -------------------------------------------------------------
app.post('/api/cv', checkApiToken, (req, res) => {
  let jsonData = req.body;
  if (typeof jsonData === 'string') {
    try {
      jsonData = JSON.parse(jsonData);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }

  // Validate JSON against json-schema
  const isValid = validateCvJson(jsonData);
  if (!isValid) {
    return res.status(400).json({
      error: 'JSON Schema Validation Failed',
      details: validateCvJson.errors
    });
  }

  const id = crypto.randomUUID();
  const markdown = jsonToMarkdown(jsonData);
  const { title, jsonLd } = extractTitleAndJsonLd(markdown);

  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const baseUrl = `${proto}://${host}`;

  const fullHtml = renderCvHtml({
    markdown,
    title,
    jsonLd,
    rawMdUrl: `/${id}.md`,
    pdfUrl: `/${id}.pdf`,
    jsonUrl: `/${id}.json`,
    id,
    showAdmin: false
  });

  const rawJsonString = JSON.stringify(jsonData, null, 2);

  db.prepare(`
    INSERT INTO pages (id, title, markdown, html, json_ld, json_data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, title, markdown, fullHtml, JSON.stringify(jsonLd), rawJsonString);

  return res.status(201).json({
    id,
    title,
    url: `${baseUrl}/${id}`,
    markdownUrl: `${baseUrl}/${id}.md`,
    pdfUrl: `${baseUrl}/${id}.pdf`,
    jsonUrl: `${baseUrl}/${id}.json`,
    createdAt: new Date().toISOString()
  });
});

// -------------------------------------------------------------
// API TOKEN MANAGEMENT ENDPOINTS
// -------------------------------------------------------------
app.get('/api/tokens', checkAdminAuth, (req, res) => {
  const tokens = db.prepare('SELECT token, name, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC').all();
  res.json({ tokens });
});

app.post('/api/tokens', checkAdminAuth, (req, res) => {
  const name = req.body.name || 'API Client';
  const token = createApiToken(name);
  res.status(201).json({ token, name });
});

app.delete('/api/tokens/:token', checkAdminAuth, (req, res) => {
  db.prepare('DELETE FROM api_tokens WHERE token = ?').run(req.params.token);
  res.json({ success: true });
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

app.get('/admin', checkAdminAuth, (req, res) => {
  const editId = req.query.edit || 'root';
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(editId) || db.prepare('SELECT * FROM pages WHERE id = ?').get('root');
  const allPages = db.prepare('SELECT id, title, created_at, updated_at FROM pages ORDER BY created_at DESC').all();
  const allTokens = db.prepare('SELECT token, name, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC').all();

  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const baseUrl = `${proto}://${host}`;

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
    .page-item a { display: block; padding: 8px 12px; border-radius: 6px; text-decoration: none; color: #2d3748; font-size: 0.9rem; background: #fff; border: 1px solid #e2e8f0; word-break: break-all; }
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
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.9rem; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
    th { background: #f7fafc; color: #4a5568; }
  </style>
</head>
<body>
  <header>
    <h1>CV Management Admin</h1>
    <div class="nav">
      <a href="/" target="_blank">🌐 Live CV</a>
      <a href="/cv.md" target="_blank">📄 Markdown</a>
      <a href="/cv.json" target="_blank">{ } JSON</a>
      <a href="/cv.pdf" target="_blank">📥 PDF</a>
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

      <h2 style="margin-top: 32px;">API Tokens</h2>
      <div style="font-size: 0.82rem; margin-bottom: 8px;">Authorized tokens for <code>POST /api/cv</code>:</div>
      <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.8rem;">
        ${allTokens.map(t => `
          <li style="margin-bottom: 6px; padding: 6px; background: white; border-radius: 4px; border: 1px solid #cbd5e0;">
            <strong>${escapeHtml(t.name)}</strong><br/>
            <code>${t.token}</code>
          </li>
        `).join('')}
      </ul>
      <button class="btn btn-secondary" style="width: 100%; margin-top: 8px;" onclick="createToken()">+ Generate New Token</button>
    </aside>
    <main>
      <div class="editor-header">
        <div>
          <h2>Editing: ${page.id === 'root' ? '⭐️ Main CV (/)' : page.id}</h2>
          <div style="font-size: 0.85rem; color: #718096;">
            HTML: <a href="${page.id === 'root' ? '/' : `/${page.id}`}" target="_blank">${page.id === 'root' ? '/' : `/${page.id}`}</a> |
            Markdown: <a href="${page.id === 'root' ? '/cv.md' : `/${page.id}.md`}" target="_blank">.md</a> |
            JSON: <a href="${page.id === 'root' ? '/cv.json' : `/${page.id}.json`}" target="_blank">.json</a> |
            PDF: <a href="${page.id === 'root' ? '/cv.pdf' : `/${page.id}.pdf`}" target="_blank">.pdf</a> |
            JSON-LD: <a href="${page.id === 'root' ? '/jsonld' : `/cv/${page.id}/jsonld`}" target="_blank">Schema</a>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          ${page.id !== 'root' ? `<button class="btn btn-danger" onclick="deletePage('${page.id}')">Delete</button>` : ''}
          <button class="btn btn-success" onclick="saveCv()">Save Changes</button>
        </div>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="showTab('editor')">Markdown Editor</div>
        <div class="tab" onclick="showTab('json')">JSON Data</div>
        <div class="tab" onclick="showTab('preview')">Live HTML Preview</div>
        <div class="tab" onclick="showTab('jsonld')">Schema.org JSON-LD</div>
      </div>

      <div id="tab-editor">
        <textarea id="markdown-input">${escapeHtml(page.markdown)}</textarea>
      </div>

      <div id="tab-json" style="display: none;">
        <p style="font-size: 0.88rem; color: #4a5568;">This JSON is synchronized with the Markdown and validated with JSON Schema:</p>
        <textarea id="json-input">${escapeHtml(page.json_data || '')}</textarea>
        <button class="btn btn-primary" style="margin-top: 8px;" onclick="syncJsonToMarkdown()">Convert JSON &rarr; Markdown</button>
      </div>

      <div id="tab-preview" style="display: none;">
        <div class="preview-box" id="preview-content">Loading...</div>
      </div>

      <div id="tab-jsonld" style="display: none;">
        <p style="font-size: 0.9rem; color: #4a5568;">Schema.org microdata automatically rendered in <code>&lt;script type="application/ld+json"&gt;</code>:</p>
        <pre><code id="jsonld-content" style="display:block; padding:16px; background:#2d3748; color:#f7fafc; border-radius:6px; font-size:0.9rem;">${escapeHtml(page.json_ld)}</code></pre>
      </div>

      <div class="api-docs">
        <strong>⚡ POST /api/cv (Create CV via JSON API):</strong>
        <p>Send a POST request with JSON conforming to <code>Developer CV</code> schema and your Bearer API token:</p>
        <pre style="background:#2d3748; color:#edf2f7; padding:10px; border-radius:4px; overflow-x:auto;"><code>curl -X POST ${baseUrl}/api/cv \\
  -H "Authorization: Bearer ${allTokens[0]?.token || 'TOKEN'}" \\
  -H "Content-Type: application/json" \\
  -d @cv.json</code></pre>
        <strong>Response:</strong>
        <pre style="background:#2d3748; color:#edf2f7; padding:10px; border-radius:4px; overflow-x:auto;"><code>{
  "id": "e30e71bc-40aa-43d9-959c-09b9f7a5bb0b",
  "url": "${baseUrl}/e30e71bc-40aa-43d9-959c-09b9f7a5bb0b",
  "markdownUrl": "${baseUrl}/e30e71bc-40aa-43d9-959c-09b9f7a5bb0b.md",
  "pdfUrl": "${baseUrl}/e30e71bc-40aa-43d9-959c-09b9f7a5bb0b.pdf",
  "jsonUrl": "${baseUrl}/e30e71bc-40aa-43d9-959c-09b9f7a5bb0b.json"
}</code></pre>
      </div>
    </main>
  </div>

  <script>
    const currentId = "${page.id}";

    function showTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-editor').style.display = name === 'editor' ? 'block' : 'none';
      document.getElementById('tab-json').style.display = name === 'json' ? 'block' : 'none';
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
      const jsonText = document.getElementById('json-input').value;
      const res = await fetch('/admin/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentId, markdown: md, json_data: jsonText })
      });
      if (res.ok) {
        alert('CV saved successfully!');
        window.location.reload();
      } else {
        alert('Error saving CV');
      }
    }

    async function syncJsonToMarkdown() {
      try {
        const jsonVal = JSON.parse(document.getElementById('json-input').value);
        const res = await fetch('/api/convert/json-to-md', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jsonVal)
        });
        const data = await res.json();
        if (data.markdown) {
          document.getElementById('markdown-input').value = data.markdown;
          alert('Markdown successfully synchronized from JSON!');
        }
      } catch (err) {
        alert('Invalid JSON: ' + err.message);
      }
    }

    async function createToken() {
      const name = prompt('Enter a name for this API Token:', 'Integration Token');
      if (!name) return;
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.token) {
        alert('Created API Token:\\n' + data.token);
        window.location.reload();
      }
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
app.post('/admin/save', checkAdminAuth, (req, res) => {
  const { id, markdown, json_data } = req.body;
  if (!markdown) {
    return res.status(400).json({ error: 'Markdown content required' });
  }

  const { title, jsonLd } = extractTitleAndJsonLd(markdown);
  const fullHtml = renderCvHtml({
    markdown,
    title,
    jsonLd,
    rawMdUrl: id === 'root' ? '/cv.md' : `/${id}.md`,
    pdfUrl: id === 'root' ? '/cv.pdf' : `/${id}.pdf`,
    jsonUrl: id === 'root' ? '/cv.json' : `/${id}.json`,
    id,
    showAdmin: false
  });

  db.prepare(`
    INSERT INTO pages (id, title, markdown, html, json_ld, json_data, pdf_blob, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      markdown = excluded.markdown,
      html = excluded.html,
      json_ld = excluded.json_ld,
      json_data = excluded.json_data,
      pdf_blob = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).run(id || 'root', title, markdown, fullHtml, JSON.stringify(jsonLd), json_data || null);

  return res.json({ success: true, id, title });
});

// Admin delete action
app.post('/admin/delete', checkAdminAuth, (req, res) => {
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

// Utility to convert JSON to Markdown
app.post('/api/convert/json-to-md', (req, res) => {
  const md = jsonToMarkdown(req.body);
  res.json({ markdown: md });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CV Server running on http://0.0.0.0:${PORT}`);
});
