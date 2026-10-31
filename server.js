require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { renderCvHtml, extractTitleAndJsonLd } = require('./renderer');
const { generatePdfFromHtml } = require('./pdf');
const { jsonToMarkdown } = require('./converter');
const { generateOpenApiSpec, renderSwaggerUiHtml } = require('./openapi');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// Load and compile JSON Schema
const schemaPath = path.join(__dirname, 'schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateCvJson = ajv.compile(schema);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -------------------------------------------------------------
// NO-CACHE MIDDLEWARE
// Prevent browsers and proxies from caching CV files and API responses
// -------------------------------------------------------------
function setNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

app.use((req, res, next) => {
  setNoCache(res);
  next();
});

// -------------------------------------------------------------
// AUTHENTICATION HELPERS
// -------------------------------------------------------------

function checkApiToken(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-api-key']) {
    token = String(req.headers['x-api-key']).trim();
  } else if (req.query.token) {
    token = String(req.query.token).trim();
  }

  if (token === ADMIN_PASSWORD) {
    req.apiUser = { name: 'admin' };
    return next();
  }

  if (token) {
    const tokenRecord = storage.findToken(token);
    if (tokenRecord) {
      storage.touchToken(token);
      req.apiUser = tokenRecord;
      return next();
    }
  }

  return res.status(401).json({
    error: 'Unauthorized. Provide a valid Bearer token, x-api-key header, or ?token='
  });
}

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
    .card { background: white; padding: 32px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); width: 100%; max-width: 380px; }
    h1 { margin-top: 0; font-size: 20px; font-weight: 600; color: #2d3748; }
    label { display: block; margin-bottom: 8px; font-size: 14px; color: #4a5568; }
    input[type="password"] { width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 6px; box-sizing: border-box; font-size: 14px; margin-bottom: 16px; }
    button { width: 100%; background: #3182ce; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: 500; cursor: pointer; font-size: 14px; }
    button:hover { background: #2b6cb0; }
    .error { color: #e53e3e; font-size: 13px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>CV Management Login</h1>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/admin/login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autofocus autocomplete="current-password" placeholder="Enter admin password">
      <button type="submit">Log in</button>
    </form>
  </div>
</body>
</html>`;
}

// -------------------------------------------------------------
// INITIALIZE ROOT CV & DEFAULT TOKENS IF EMPTY
// -------------------------------------------------------------
function initializeRootCv() {
  const rootHtmlExists = storage.fileExists('root', '.html');
  const cvJsonPath = path.join(__dirname, 'cv.json');
  const cvMdPath = path.join(__dirname, 'cv.md');

  if (!rootHtmlExists) {
    console.log('Initializing root CV static files...');
    let jsonToUse = null;
    let mdToUse = null;

    if (fs.existsSync(cvJsonPath)) {
      try {
        jsonToUse = JSON.parse(fs.readFileSync(cvJsonPath, 'utf-8'));
        mdToUse = jsonToMarkdown(jsonToUse);
      } catch (e) {
        console.error('Error parsing cv.json:', e);
      }
    }

    if (!mdToUse && fs.existsSync(cvMdPath)) {
      mdToUse = fs.readFileSync(cvMdPath, 'utf-8');
    }

    if (!mdToUse) {
      mdToUse = '# Dmitry Koldyaev\n## Frontend Developer\n';
    }

    const { title, jsonLd } = extractTitleAndJsonLd(mdToUse);
    const fullHtml = renderCvHtml({
      markdown: mdToUse,
      title,
      jsonLd,
      rawMdUrl: '/cv.md',
      pdfUrl: '/cv.pdf',
      jsonUrl: '/cv.json',
      id: 'root',
      showAdmin: false
    });

    storage.savePageFiles({
      id: 'root',
      title: title || 'Dmitry Koldyaev - Frontend Developer',
      markdown: mdToUse,
      html: fullHtml,
      json_ld: jsonLd,
      json_data: jsonToUse
    });
    console.log('Root CV static files generated successfully.');
  }

  // Ensure at least one initial API token exists
  const tokens = storage.getTokens();
  if (tokens.length === 0) {
    const initialToken = storage.createToken('Default Admin Token');
    console.log(`Created default API token: ${initialToken.token}`);
  }
}
initializeRootCv();

// -------------------------------------------------------------
// LAZY PDF GENERATION HELPER
// -------------------------------------------------------------
async function serveCvPdf(id, req, res) {
  setNoCache(res);
  const pdfPath = storage.getFilePath(id, '.pdf');
  const htmlPath = storage.getFilePath(id, '.html');

  // 1. If static PDF already generated on disk, serve it directly
  if (fs.existsSync(pdfPath)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cv-${id}.pdf"`);
    return res.sendFile(pdfPath);
  }

  // 2. If HTML does not exist, 404
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('CV version not found');
  }

  // 3. Generate lazily using Puppeteer and save directly as static .pdf file
  try {
    console.log(`Lazy generating static PDF for [${id}]...`);
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const pdfBuffer = await generatePdfFromHtml(htmlContent);

    // Write file to disk
    fs.writeFileSync(pdfPath, pdfBuffer);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cv-${id}.pdf"`);
    return res.sendFile(pdfPath);
  } catch (err) {
    console.error('PDF generation error:', err);
    return res.status(500).send('Error generating PDF');
  }
}

// -------------------------------------------------------------
// PUBLIC CV STATIC ROUTES
// -------------------------------------------------------------

// 1. Root CV (HTML)
app.get('/', (req, res) => {
  setNoCache(res);
  const htmlPath = storage.getFilePath('root', '.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('CV Not Found');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(htmlPath);
});

// Original / Legacy HTML static view
app.get('/legacy', (req, res) => {
  setNoCache(res);
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.redirect('/');
  }
});

// Root Markdown, JSON, PDF
app.get(['/cv.md', '/raw', '/index.md'], (req, res) => {
  setNoCache(res);
  const mdPath = storage.getFilePath('root', '.md');
  if (!fs.existsSync(mdPath)) return res.status(404).send('CV Not Found');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(mdPath);
});

app.get(['/cv.json', '/root.json'], (req, res) => {
  setNoCache(res);
  const jsonPath = storage.getFilePath('root', '.json');
  if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: 'CV JSON not found' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.sendFile(jsonPath);
});

app.get('/cv.pdf', async (req, res) => {
  await serveCvPdf('root', req, res);
});

// JSON-LD direct endpoint
app.get('/jsonld', (req, res) => {
  setNoCache(res);
  const jsonLdPath = storage.getFilePath('root', '.jsonld');
  if (!fs.existsSync(jsonLdPath)) return res.setHeader('Content-Type', 'application/ld+json; charset=utf-8').send('{}');
  res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
  res.sendFile(jsonLdPath);
});

// JSON Schema endpoint
app.get(['/schema.json', '/api/schema'], (req, res) => {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.sendFile(schemaPath);
});

// -------------------------------------------------------------
// OPENAPI DOCUMENTATION ENDPOINTS (Publicly accessible)
// -------------------------------------------------------------
app.get('/openapi.json', (req, res) => {
  setNoCache(res);
  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const baseUrl = `${proto}://${host}`;
  const spec = generateOpenApiSpec(baseUrl);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(spec, null, 2));
});

app.get(['/api/docs', '/docs'], (req, res) => {
  setNoCache(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderSwaggerUiHtml('/openapi.json'));
});

// -------------------------------------------------------------
// DYNAMIC CV ROUTES BY UUID: /:id, /:id.md, /:id.json, /:id.pdf
// -------------------------------------------------------------

// 1. UUID HTML page
app.get('/:id', (req, res, next) => {
  const id = req.params.id;
  if (id === 'favicon.ico' || id === 'admin' || id === 'api' || id === 'cv' || id === 'jsonld' || id === 'legacy' || id === 'docs' || id === 'openapi.json') {
    return next();
  }

  const htmlPath = storage.getFilePath(id, '.html');
  if (!fs.existsSync(htmlPath)) {
    return next();
  }
  setNoCache(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(htmlPath);
});

// 2. UUID.md
app.get('/:id.md', (req, res, next) => {
  const id = req.params.id;
  const mdPath = storage.getFilePath(id, '.md');
  if (!fs.existsSync(mdPath)) return next();
  setNoCache(res);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(mdPath);
});

// 3. UUID.json
app.get('/:id.json', (req, res, next) => {
  const id = req.params.id;
  const jsonPath = storage.getFilePath(id, '.json');
  if (!fs.existsSync(jsonPath)) return next();
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.sendFile(jsonPath);
});

// 4. UUID.pdf
app.get('/:id.pdf', async (req, res, next) => {
  const id = req.params.id;
  const htmlPath = storage.getFilePath(id, '.html');
  if (!fs.existsSync(htmlPath)) return next();
  await serveCvPdf(id, req, res);
});

// Legacy /cv/:id backwards compatibility
app.get('/cv/:id', (req, res) => res.redirect(`/${req.params.id}`));
app.get('/cv/:id/md', (req, res) => res.redirect(`/${req.params.id}.md`));
app.get('/cv/:id/json', (req, res) => res.redirect(`/${req.params.id}.json`));
app.get('/cv/:id/pdf', (req, res) => res.redirect(`/${req.params.id}.pdf`));
app.get('/cv/:id/jsonld', (req, res) => {
  const jsonLdPath = storage.getFilePath(req.params.id, '.jsonld');
  if (!fs.existsSync(jsonLdPath)) return res.status(404).json({ error: 'CV not found' });
  setNoCache(res);
  res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
  res.sendFile(jsonLdPath);
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

  // Save static files directly to disk
  storage.savePageFiles({
    id,
    title,
    markdown,
    html: fullHtml,
    json_ld: jsonLd,
    json_data: jsonData
  });

  setNoCache(res);
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
  setNoCache(res);
  res.json({ tokens: storage.getTokens() });
});

app.post('/api/tokens', checkAdminAuth, (req, res) => {
  const name = req.body.name || 'API Client';
  const tokenRecord = storage.createToken(name);
  setNoCache(res);
  res.status(201).json({ token: tokenRecord.token, name: tokenRecord.name });
});

app.delete('/api/tokens/:token', checkAdminAuth, (req, res) => {
  storage.deleteToken(req.params.token);
  setNoCache(res);
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
  setNoCache(res);
  const editId = req.query.edit || 'root';

  const allPages = storage.getAllPages();
  const allTokens = storage.getTokens();

  // Read current page markdown and JSON if available
  const markdown = storage.readFileContent(editId, '.md') || storage.readFileContent('root', '.md') || '';
  const jsonData = storage.readFileContent(editId, '.json') || storage.readFileContent('root', '.json') || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CV Admin Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: #f4f6f8;
      color: #333;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    header {
      background: #1a202c;
      color: white;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header-title {
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-links a {
      color: #cbd5e0;
      text-decoration: none;
      margin-left: 16px;
      font-size: 14px;
    }
    .header-links a:hover {
      color: white;
    }
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .sidebar {
      width: 320px;
      background: white;
      border-right: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .sidebar-section {
      padding: 16px;
      border-bottom: 1px solid #edf2f7;
    }
    .sidebar-section h3 {
      margin: 0 0 12px 0;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #718096;
    }
    .page-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      margin-bottom: 4px;
      border-radius: 6px;
      font-size: 13px;
      text-decoration: none;
      color: #2d3748;
      background: #f7fafc;
      border: 1px solid transparent;
    }
    .page-item:hover {
      background: #edf2f7;
    }
    .page-item.active {
      background: #ebf8ff;
      border-color: #bee3f8;
      color: #2b6cb0;
      font-weight: 600;
    }
    .editor-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .toolbar {
      padding: 10px 20px;
      background: white;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tabs {
      display: flex;
      gap: 8px;
    }
    .tab-btn {
      padding: 6px 14px;
      border: 1px solid #e2e8f0;
      background: #f7fafc;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .tab-btn.active {
      background: #3182ce;
      color: white;
      border-color: #3182ce;
    }
    .workspace {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 16px;
      overflow: hidden;
    }
    textarea {
      flex: 1;
      width: 100%;
      border: 1px solid #cbd5e0;
      border-radius: 6px;
      padding: 12px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 13px;
      line-height: 1.5;
      resize: none;
      outline: none;
    }
    textarea:focus {
      border-color: #3182ce;
      box-shadow: 0 0 0 1px #3182ce;
    }
    iframe {
      flex: 1;
      border: 1px solid #cbd5e0;
      border-radius: 6px;
      background: white;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-primary {
      background: #3182ce;
      color: white;
    }
    .btn-primary:hover {
      background: #2b6cb0;
    }
    .btn-secondary {
      background: #edf2f7;
      color: #4a5568;
    }
    .btn-secondary:hover {
      background: #e2e8f0;
    }
    .btn-danger {
      background: #fff5f5;
      color: #e53e3e;
      border: 1px solid #feb2b2;
    }
    .btn-danger:hover {
      background: #fed7d7;
    }
    .token-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #edf2f7;
      font-size: 12px;
    }
    .token-key {
      font-family: monospace;
      background: #edf2f7;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-title">
      📄 <span>CV Management Dashboard (Static Files)</span>
    </div>
    <div class="header-links">
      <a href="/api/docs" target="_blank" style="color: #68d391; font-weight: 500;">📖 OpenAPI Docs ↗</a>
      <a href="${editId === 'root' ? '/' : `/${editId}`}" target="_blank">View Live CV ↗</a>
      <a href="${editId === 'root' ? '/cv.pdf' : `/${editId}.pdf`}" target="_blank">PDF ↗</a>
      <a href="${editId === 'root' ? '/cv.md' : `/${editId}.md`}" target="_blank">Markdown ↗</a>
      <a href="${editId === 'root' ? '/cv.json' : `/${editId}.json`}" target="_blank">JSON ↗</a>
      <a href="/admin/logout">Logout</a>
    </div>
  </header>

  <div class="main">
    <div class="sidebar">
      <div class="sidebar-section">
        <h3>CV Pages (${allPages.length})</h3>
        ${allPages.map(p => `
          <a href="/admin?edit=${p.id}" class="page-item ${p.id === editId ? 'active' : ''}">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <div><strong>${p.id === 'root' ? '★ Main CV (root)' : p.id.substring(0, 8) + '...'}</strong></div>
              <small style="color: #a0aec0;">${p.title}</small>
            </div>
            ${p.id !== 'root' ? `<button onclick="event.preventDefault(); deletePage('${p.id}')" style="background:none;border:none;color:#e53e3e;cursor:pointer;">✕</button>` : ''}
          </a>
        `).join('')}
      </div>

      <div class="sidebar-section">
        <h3>API Tokens</h3>
        <div id="tokensList">
          ${allTokens.map(t => `
            <div class="token-row">
              <div>
                <div><strong>${t.name}</strong></div>
                <div class="token-key">${t.token.substring(0, 14)}...</div>
              </div>
              <button onclick="deleteToken('${t.token}')" style="background:none;border:none;color:#e53e3e;cursor:pointer;">✕</button>
            </div>
          `).join('')}
        </div>
        <div style="margin-top: 12px;">
          <input type="text" id="newTokenName" placeholder="Client Name" style="width:100%;padding:6px;border:1px solid #cbd5e0;border-radius:4px;font-size:12px;margin-bottom:6px;">
          <button onclick="createToken()" class="btn btn-secondary" style="width:100%;font-size:12px;justify-content:center;">+ Generate New Token</button>
        </div>
      </div>
    </div>

    <div class="editor-container">
      <div class="toolbar">
        <div class="tabs">
          <button id="tabMd" class="tab-btn active" onclick="switchTab('md')">Markdown Editor</button>
          <button id="tabJson" class="tab-btn" onclick="switchTab('json')">JSON Data</button>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="btnConvert" class="btn btn-secondary" onclick="convertJsonToMarkdown()" style="display:none;">Convert JSON → Markdown</button>
          <button class="btn btn-primary" onclick="saveCv()">💾 Save CV</button>
        </div>
      </div>

      <div class="workspace">
        <div class="pane">
          <textarea id="markdownEditor" spellcheck="false" placeholder="Write markdown here...">${escapeHtml(markdown)}</textarea>
          <textarea id="jsonEditor" spellcheck="false" style="display:none;" placeholder="Paste CV JSON here...">${escapeHtml(jsonData)}</textarea>
        </div>
        <div class="pane">
          <iframe id="previewFrame" src="about:blank"></iframe>
        </div>
      </div>
    </div>
  </div>

  <script>
    const currentId = '${editId}';
    let currentTab = 'md';

    function switchTab(tab) {
      currentTab = tab;
      const mdEditor = document.getElementById('markdownEditor');
      const jsonEditor = document.getElementById('jsonEditor');
      const tabMd = document.getElementById('tabMd');
      const tabJson = document.getElementById('tabJson');
      const btnConvert = document.getElementById('btnConvert');

      if (tab === 'md') {
        mdEditor.style.display = 'block';
        jsonEditor.style.display = 'none';
        tabMd.classList.add('active');
        tabJson.classList.remove('active');
        btnConvert.style.display = 'none';
        updatePreview();
      } else {
        mdEditor.style.display = 'none';
        jsonEditor.style.display = 'block';
        tabJson.classList.add('active');
        tabMd.classList.remove('active');
        btnConvert.style.display = 'inline-flex';
      }
    }

    async function convertJsonToMarkdown() {
      const jsonText = document.getElementById('jsonEditor').value;
      try {
        const parsed = JSON.parse(jsonText);
        const res = await fetch('/api/convert/json-to-md', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed)
        });
        const data = await res.json();
        if (data.markdown) {
          document.getElementById('markdownEditor').value = data.markdown;
          switchTab('md');
          updatePreview();
        }
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
      }
    }

    let previewDebounce = null;
    function updatePreview() {
      clearTimeout(previewDebounce);
      previewDebounce = setTimeout(async () => {
        const md = document.getElementById('markdownEditor').value;
        try {
          const res = await fetch('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markdown: md })
          });
          const data = await res.json();
          const doc = document.getElementById('previewFrame').contentWindow.document;
          doc.open();
          doc.write(data.html);
          doc.close();
        } catch (e) {
          console.error(e);
        }
      }, 300);
    }

    document.getElementById('markdownEditor').addEventListener('input', updatePreview);
    updatePreview();

    async function saveCv() {
      const markdown = document.getElementById('markdownEditor').value;
      const jsonText = document.getElementById('jsonEditor').value;
      let jsonData = null;
      if (jsonText.trim()) {
        try { jsonData = JSON.parse(jsonText); } catch (e) {}
      }

      const res = await fetch('/admin/save?id=' + currentId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, json_data: jsonData })
      });
      const data = await res.json();
      if (data.success) {
        alert('CV saved successfully!');
        window.location.reload();
      } else {
        alert('Error saving CV: ' + (data.error || 'Unknown error'));
      }
    }

    async function deletePage(id) {
      if (!confirm('Are you sure you want to delete CV ' + id + '?')) return;
      const res = await fetch('/admin/delete?id=' + id, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        window.location.href = '/admin';
      }
    }

    async function createToken() {
      const name = document.getElementById('newTokenName').value.trim() || 'API Key';
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.token) {
        prompt('Copy your new API token:', data.token);
        window.location.reload();
      }
    }

    async function deleteToken(token) {
      if (!confirm('Delete this token?')) return;
      await fetch('/api/tokens/' + token, { method: 'DELETE' });
      window.location.reload();
    }
  </script>
</body>
</html>`;

  res.send(html);
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Admin save action
app.post('/admin/save', checkAdminAuth, (req, res) => {
  const id = req.query.id || 'root';
  const { markdown, json_data } = req.body;

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

  storage.savePageFiles({
    id: id || 'root',
    title,
    markdown,
    html: fullHtml,
    json_ld: jsonLd,
    json_data: json_data || null
  });

  return res.json({ success: true, id, title });
});

// Admin delete action
app.post('/admin/delete', checkAdminAuth, (req, res) => {
  const id = req.query.id;
  if (!id || id === 'root') {
    return res.status(400).json({ error: 'Cannot delete root page' });
  }
  storage.deletePageFiles(id);
  res.json({ success: true });
});

// Admin live preview API
app.post('/api/preview', (req, res) => {
  setNoCache(res);
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
  setNoCache(res);
  const md = jsonToMarkdown(req.body);
  res.json({ markdown: md });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CV Server running on http://0.0.0.0:${PORT} (Static Files Storage)`);
});
