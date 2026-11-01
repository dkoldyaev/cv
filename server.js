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
const templater = require('./templater');
const { renderAdminPage } = require('./admin');

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
  const origSendFile = res.sendFile.bind(res);
  res.sendFile = function(filePath, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    }
    opts = Object.assign({ dotfiles: 'allow' }, opts);
    return origSendFile(filePath, opts, cb);
  };
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
    const htmlTemplate = templater.getTemplateContent('default.html');
    const fullHtml = templater.renderHtmlTemplate(htmlTemplate, {
      markdown: mdToUse,
      title,
      jsonLd,
      rawMdUrl: '/cv.md',
      pdfUrl: '/cv.pdf',
      jsonUrl: '/cv.json',
      id: 'root',
      showAdmin: false,
      jsonData: jsonToUse
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

  const htmlTemplate = templater.getTemplateContent('default.html');
  const fullHtml = templater.renderHtmlTemplate(htmlTemplate, {
    markdown,
    title,
    jsonLd,
    rawMdUrl: `/${id}.md`,
    pdfUrl: `/${id}.pdf`,
    jsonUrl: `/${id}.json`,
    id,
    showAdmin: false,
    jsonData
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
  const allTemplates = templater.getAllTemplates();
  const activeTemplateId = req.query.template || (allTemplates.length > 0 ? allTemplates[0].id : 'default.html');
  const activeTemplateContent = templater.getTemplateContent(activeTemplateId) || '';

  // Read current page markdown and JSON if available
  const markdown = storage.readFileContent(editId, '.md') || storage.readFileContent('root', '.md') || '';
  const jsonData = storage.readFileContent(editId, '.json') || storage.readFileContent('root', '.json') || '';

  const html = renderAdminPage({
    editId,
    allPages,
    allTokens,
    allTemplates,
    activeTemplateId,
    activeTemplateContent,
    markdown,
    jsonData
  });

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
  const htmlTemplate = templater.getTemplateContent('default.html');
  const fullHtml = templater.renderHtmlTemplate(htmlTemplate, {
    markdown,
    title,
    jsonLd,
    rawMdUrl: id === 'root' ? '/cv.md' : `/${id}.md`,
    pdfUrl: id === 'root' ? '/cv.pdf' : `/${id}.pdf`,
    jsonUrl: id === 'root' ? '/cv.json' : `/${id}.json`,
    id,
    showAdmin: false,
    jsonData: json_data || null
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

// -------------------------------------------------------------
// TEMPLATES API ENDPOINTS
// -------------------------------------------------------------
app.get('/api/templates', checkAdminAuth, (req, res) => {
  setNoCache(res);
  res.json({ templates: templater.getAllTemplates() });
});

// Dynamic template live preview
app.post('/api/templates/preview', checkAdminAuth, (req, res) => {
  setNoCache(res);
  const { templateId, templateContent, markdown, jsonData } = req.body;
  const tplId = templateId || 'default.html';

  let cvData = jsonData;
  if (!cvData) {
    const rootJsonStr = storage.readFileContent('root', '.json');
    if (rootJsonStr) {
      try { cvData = JSON.parse(rootJsonStr); } catch (e) {}
    }
    if (!cvData && fs.existsSync(path.join(__dirname, 'cv.json'))) {
      try { cvData = JSON.parse(fs.readFileSync(path.join(__dirname, 'cv.json'), 'utf-8')); } catch (e) {}
    }
  }

  const rawMd = markdown || (cvData ? jsonToMarkdown(cvData) : storage.readFileContent('root', '.md') || '');

  try {
    const content = templateContent !== undefined ? templateContent : templater.getTemplateContent(tplId);

    if (tplId.endsWith('.html') || tplId.includes('html')) {
      const { title, jsonLd } = extractTitleAndJsonLd(rawMd);
      const rendered = templater.renderHtmlTemplate(content, {
        markdown: rawMd,
        title,
        jsonLd,
        rawMdUrl: '/cv.md',
        pdfUrl: '/cv.pdf',
        jsonUrl: '/cv.json',
        jsonData: cvData
      });
      return res.json({ type: 'html', rendered });
    } else if (tplId.endsWith('.json') || tplId.includes('json')) {
      const rendered = templater.renderJsonTemplate(content, cvData || {});
      return res.json({ type: 'json', rendered });
    } else {
      const rendered = templater.renderMarkdownTemplate(content, cvData || {});
      return res.json({ type: 'md', rendered });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Rendering error: ' + err.message, rendered: 'Error: ' + err.message });
  }
});

app.get('/api/templates/:id', checkAdminAuth, (req, res) => {
  setNoCache(res);
  const id = req.params.id;
  const content = templater.getTemplateContent(id);
  if (content === null) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.json({ id, content });
});

app.post('/api/templates/:id/reset', checkAdminAuth, (req, res) => {
  setNoCache(res);
  const id = req.params.id;
  const defaultContent = templater.resetTemplate(id);
  res.json({ success: true, id, content: defaultContent });
});

app.post('/api/templates/:id', checkAdminAuth, (req, res) => {
  setNoCache(res);
  const id = req.params.id;
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Template content must be a string' });
  }

  // Validate syntax by doing a test render with cv.json or dummy data
  try {
    const cvJson = storage.readFileContent('root', '.json') || fs.readFileSync(path.join(__dirname, 'cv.json'), 'utf-8');
    const parsedData = typeof cvJson === 'string' ? JSON.parse(cvJson) : cvJson;
    const testMd = storage.readFileContent('root', '.md') || fs.readFileSync(path.join(__dirname, 'cv.md'), 'utf-8');

    if (id.endsWith('.html') || id.includes('html')) {
      templater.renderHtmlTemplate(content, { markdown: testMd, jsonData: parsedData });
    } else if (id.endsWith('.json') || id.includes('json')) {
      templater.renderJsonTemplate(content, parsedData);
    } else {
      templater.renderMarkdownTemplate(content, parsedData);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Template compilation error: ' + err.message });
  }

  templater.saveTemplateContent(id, content);
  res.json({ success: true, id });
});

// Admin live preview API
app.post('/api/preview', (req, res) => {
  setNoCache(res);
  const { markdown } = req.body;
  const { title, jsonLd } = extractTitleAndJsonLd(markdown || '');
  const htmlTemplate = templater.getTemplateContent('default.html');
  const html = templater.renderHtmlTemplate(htmlTemplate, {
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
