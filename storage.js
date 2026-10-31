const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(DATA_DIR, 'public');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const METADATA_FILE = path.join(DATA_DIR, 'pages.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// -------------------------------------------------------------
// TOKENS STORAGE (data/tokens.json)
// -------------------------------------------------------------
function readTokens() {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error reading tokens file:', e);
    return [];
  }
}

function writeTokens(tokens) {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing tokens file:', e);
  }
}

function getTokens() {
  return readTokens().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function findToken(tokenStr) {
  if (!tokenStr) return null;
  const tokens = readTokens();
  return tokens.find(t => t.token === tokenStr) || null;
}

function touchToken(tokenStr) {
  const tokens = readTokens();
  const token = tokens.find(t => t.token === tokenStr);
  if (token) {
    token.last_used_at = new Date().toISOString();
    writeTokens(tokens);
  }
}

function createToken(name = 'API Client') {
  const token = 'cvt_' + crypto.randomBytes(24).toString('hex');
  const tokens = readTokens();
  const newToken = {
    token,
    name,
    created_at: new Date().toISOString(),
    last_used_at: null
  };
  tokens.push(newToken);
  writeTokens(tokens);
  return newToken;
}

function deleteToken(tokenStr) {
  let tokens = readTokens();
  tokens = tokens.filter(t => t.token !== tokenStr);
  writeTokens(tokens);
}

// -------------------------------------------------------------
// PAGES METADATA STORAGE (data/pages.json)
// -------------------------------------------------------------
function readPagesMeta() {
  try {
    if (!fs.existsSync(METADATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error reading pages metadata:', e);
    return {};
  }
}

function writePagesMeta(meta) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(meta, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing pages metadata:', e);
  }
}

function getAllPages() {
  const meta = readPagesMeta();
  return Object.values(meta).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function getPageMeta(id) {
  const meta = readPagesMeta();
  return meta[id] || null;
}

function savePageFiles({ id, title, markdown, html, json_ld, json_data }) {
  // 1. Write static files directly into PUBLIC_DIR
  const prefix = id === 'root' ? 'cv' : id;

  if (html !== undefined) {
    fs.writeFileSync(path.join(PUBLIC_DIR, `${prefix}.html`), html, 'utf-8');
  }
  if (markdown !== undefined) {
    fs.writeFileSync(path.join(PUBLIC_DIR, `${prefix}.md`), markdown, 'utf-8');
  }
  if (json_data !== undefined && json_data !== null) {
    const jsonStr = typeof json_data === 'string' ? json_data : JSON.stringify(json_data, null, 2);
    fs.writeFileSync(path.join(PUBLIC_DIR, `${prefix}.json`), jsonStr, 'utf-8');
  }
  if (json_ld !== undefined && json_ld !== null) {
    const jsonLdStr = typeof json_ld === 'string' ? json_ld : JSON.stringify(json_ld, null, 2);
    fs.writeFileSync(path.join(PUBLIC_DIR, `${prefix}.jsonld`), jsonLdStr, 'utf-8');
  }

  // If a cached PDF existed previously for this ID, remove it so it regenerates lazily
  const pdfPath = path.join(PUBLIC_DIR, `${prefix}.pdf`);
  if (fs.existsSync(pdfPath)) {
    try { fs.unlinkSync(pdfPath); } catch (e) {}
  }

  // 2. Update metadata
  const meta = readPagesMeta();
  const existing = meta[id] || {};
  const now = new Date().toISOString();

  meta[id] = {
    id,
    title: title || existing.title || 'Curriculum Vitae',
    created_at: existing.created_at || now,
    updated_at: now
  };
  writePagesMeta(meta);

  return meta[id];
}

function deletePageFiles(id) {
  if (!id || id === 'root') return false;

  const prefix = id;
  const extensions = ['.html', '.md', '.json', '.jsonld', '.pdf'];
  for (const ext of extensions) {
    const fp = path.join(PUBLIC_DIR, `${prefix}${ext}`);
    if (fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch (e) {}
    }
  }

  const meta = readPagesMeta();
  delete meta[id];
  writePagesMeta(meta);
  return true;
}

function getFilePath(id, ext) {
  const prefix = id === 'root' ? 'cv' : id;
  return path.join(PUBLIC_DIR, `${prefix}${ext}`);
}

function fileExists(id, ext) {
  return fs.existsSync(getFilePath(id, ext));
}

function readFileContent(id, ext) {
  const fp = getFilePath(id, ext);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8');
}

module.exports = {
  DATA_DIR,
  PUBLIC_DIR,
  // Tokens
  getTokens,
  findToken,
  touchToken,
  createToken,
  deleteToken,
  // Pages & Static Files
  getAllPages,
  getPageMeta,
  savePageFiles,
  deletePageFiles,
  getFilePath,
  fileExists,
  readFileContent
};
