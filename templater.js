const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { marked } = require('marked');
const storage = require('./storage');
const { formatMonth } = require('./converter');
const { parseCvMarkdown, parseIsoDate, parseCountryCode, slugify, inlineMarkdown, escapeHtml, renderWorkExperienceHtml, renderSkillsHtml, renderLanguagesHtml, renderEducationHtml, renderVolunteerHtml, renderContactsHtml } = require('./renderer');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Ensure default templates exist on disk if missing
function ensureDefaultTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

// Built-in default template identifiers
const DEFAULT_TEMPLATES = [
  { id: 'default.html', name: 'Default HTML Template', type: 'html', filename: 'default.html.ejs' },
  { id: 'default.md', name: 'Default Markdown Template', type: 'md', filename: 'default.md.ejs' },
  { id: 'default.json', name: 'Default JSON Template', type: 'json', filename: 'default.json.ejs' }
];

function getTemplateFilePath(id) {
  // Check in storage templates first (custom user-overridden templates)
  const customPath = storage.getTemplatePath(id);
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  // Otherwise check in TEMPLATES_DIR
  const builtInPath = path.join(TEMPLATES_DIR, id.endsWith('.ejs') ? id : `${id}.ejs`);
  if (fs.existsSync(builtInPath)) {
    return builtInPath;
  }
  return null;
}

function getTemplateContent(id) {
  // Check storage custom template content
  const customContent = storage.readTemplateContent(id);
  if (customContent !== null) {
    return customContent;
  }
  const filePath = getTemplateFilePath(id);
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

function saveTemplateContent(id, content) {
  return storage.saveTemplateContent(id, content);
}

function resetTemplate(id) {
  storage.deleteTemplate(id);
  return getTemplateContent(id);
}

function getAllTemplates() {
  const customList = storage.getCustomTemplatesList();
  const list = [];

  for (const dt of DEFAULT_TEMPLATES) {
    const isCustomized = storage.hasCustomTemplate(dt.id);
    list.push({
      id: dt.id,
      name: dt.name,
      type: dt.type,
      isCustom: isCustomized,
      isDefault: true
    });
  }

  // Add any extra custom templates created by user
  for (const c of customList) {
    if (!DEFAULT_TEMPLATES.some(dt => dt.id === c.id)) {
      list.push({
        id: c.id,
        name: c.name || c.id,
        type: c.type || (c.id.endsWith('.html') ? 'html' : c.id.endsWith('.json') ? 'json' : 'md'),
        isCustom: true,
        isDefault: false
      });
    }
  }

  return list;
}

/**
 * Render Markdown using EJS template and CV data (JSON or parsed)
 */
function renderMarkdownTemplate(templateContent, data) {
  const context = {
    ...data,
    formatMonth,
    ejs
  };
  return ejs.render(templateContent, context, { escape: x => x });
}

/**
 * Render JSON using EJS template and CV data
 */
function renderJsonTemplate(templateContent, data) {
  const context = {
    ...data,
    formatMonth,
    ejs
  };
  return ejs.render(templateContent, context, { escape: x => x });
}

/**
 * Render HTML using EJS template and context
 */
function renderHtmlTemplate(templateContent, params) {
  const {
    markdown = '',
    title,
    jsonLd,
    rawMdUrl,
    pdfUrl,
    jsonUrl,
    editUrl,
    id,
    showAdmin = false,
    jsonData = null
  } = params;

  const parsed = parseCvMarkdown(markdown);
  const jsonLdString = typeof jsonLd === 'string' ? jsonLd : JSON.stringify(jsonLd, null, 2);
  const pageTitle = title || (parsed.name && parsed.title ? `${parsed.name} - ${parsed.title}` : 'Curriculum Vitae');

  const leftSections = [];
  const rightSections = [];

  for (const sec of parsed.sections) {
    const lower = sec.title.toLowerCase();
    if (lower.includes('work') || lower.includes('experience') || lower.includes('projects') || lower.includes('history')) {
      leftSections.push(sec);
    } else {
      rightSections.push(sec);
    }
  }

  let leftColumnHtml = '';
  for (const sec of leftSections) {
    leftColumnHtml += `        <h2 class="section-title">${inlineMarkdown(sec.title)}</h2>\n\n`;
    leftColumnHtml += renderWorkExperienceHtml(sec.lines);
    leftColumnHtml += '\n';
  }

  let rightColumnHtml = '';
  for (const sec of rightSections) {
    const lower = sec.title.toLowerCase();
    rightColumnHtml += `        <h2 class="section-title">${inlineMarkdown(sec.title)}</h2>\n`;
    if (lower.includes('skill')) {
      rightColumnHtml += renderSkillsHtml(sec.lines) + '\n\n';
    } else if (lower.includes('language')) {
      rightColumnHtml += renderLanguagesHtml(sec.lines) + '\n\n';
    } else if (lower.includes('education')) {
      rightColumnHtml += renderEducationHtml(sec.lines) + '\n\n';
    } else if (lower.includes('volunteer')) {
      rightColumnHtml += renderVolunteerHtml(sec.lines) + '\n';
    } else {
      rightColumnHtml += marked.parse(sec.lines.join('\n')) + '\n\n';
    }
  }

  const contactsHtml = renderContactsHtml(parsed.contacts);

  const context = {
    markdown,
    parsed,
    pageTitle,
    jsonLd,
    jsonLdString,
    rawMdUrl,
    pdfUrl,
    jsonUrl,
    editUrl,
    id,
    showAdmin,
    leftColumnHtml,
    rightColumnHtml,
    contactsHtml,
    jsonData,
    // Helper functions exposed inside EJS
    inlineMarkdown,
    escapeHtml,
    formatMonth,
    parseIsoDate,
    marked
  };

  return ejs.render(templateContent, context);
}

module.exports = {
  TEMPLATES_DIR,
  DEFAULT_TEMPLATES,
  ensureDefaultTemplates,
  getTemplateFilePath,
  getTemplateContent,
  saveTemplateContent,
  resetTemplate,
  getAllTemplates,
  renderMarkdownTemplate,
  renderJsonTemplate,
  renderHtmlTemplate
};
