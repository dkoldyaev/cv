const storage = require('./storage');
const templater = require('./templater');
const { escapeHtml } = require('./renderer');

function renderAdminPage({ editId, allPages, allTokens, allTemplates, activeTemplateId, activeTemplateContent, markdown, jsonData }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CV Admin Panel & Templater</title>
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
      display: flex;
      justify-content: space-between;
      align-items: center;
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
      cursor: pointer;
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
    .badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-html { background: #e2e8f0; color: #2d3748; }
    .badge-json { background: #feebc8; color: #7b341e; }
    .badge-md { background: #c6f6d5; color: #22543d; }
    .badge-custom { background: #fed7d7; color: #9b2c2c; }

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
      align-items: center;
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
    .pane-header {
      font-size: 12px;
      font-weight: 600;
      color: #718096;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
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
    .preview-code {
      flex: 1;
      border: 1px solid #cbd5e0;
      border-radius: 6px;
      background: #2d3748;
      color: #e2e8f0;
      padding: 12px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
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
    .btn-success {
      background: #38a169;
      color: white;
    }
    .btn-success:hover {
      background: #2f855a;
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
    .hint-bar {
      background: #ebf8ff;
      border-left: 4px solid #3182ce;
      padding: 8px 12px;
      font-size: 12px;
      color: #2b6cb0;
      margin-bottom: 10px;
      border-radius: 0 4px 4px 0;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-title">
      📄 <span>CV Management & Template Studio</span>
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
              <small style="color: #a0aec0;">${escapeHtml(p.title)}</small>
            </div>
            ${p.id !== 'root' ? `<button onclick="event.preventDefault(); deletePage('${p.id}')" style="background:none;border:none;color:#e53e3e;cursor:pointer;">✕</button>` : ''}
          </a>
        `).join('')}
      </div>

      <div class="sidebar-section">
        <h3>
          <span>Templates Studio</span>
          <span style="font-size: 11px; color: #a0aec0;">EJS Engine</span>
        </h3>
        <div id="templatesList">
          ${allTemplates.map(t => `
            <div class="page-item ${t.id === activeTemplateId ? 'active' : ''}" onclick="selectTemplate('${t.id}')">
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="badge badge-${t.type}">${t.type}</span>
                <span style="font-size:12px;font-weight:500;">${escapeHtml(t.id)}</span>
                ${t.isCustom ? `<span class="badge badge-custom" title="Customized template">mod</span>` : ''}
              </div>
              ${t.isCustom ? `<button onclick="event.stopPropagation(); resetTemplate('${t.id}')" title="Reset to default" style="background:none;border:none;color:#718096;font-size:11px;cursor:pointer;">↺ Reset</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <div class="sidebar-section">
        <h3>API Tokens</h3>
        <div id="tokensList">
          ${allTokens.map(t => `
            <div class="token-row">
              <div>
                <div><strong>${escapeHtml(t.name)}</strong></div>
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
          <button id="tabTemplate" class="tab-btn" onclick="switchTab('template')">🎨 Template Studio (<span id="activeTemplateBadge">${activeTemplateId}</span>)</button>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="btnConvert" class="btn btn-secondary" onclick="convertJsonToMarkdown()" style="display:none;">Convert JSON → Markdown</button>
          <button id="btnApplyTemplate" class="btn btn-secondary" onclick="applyTemplateToCv()" style="display:none;" title="Render current CV using active template">Apply Template to CV</button>
          <button id="btnSaveTemplate" class="btn btn-success" onclick="saveTemplate()" style="display:none;">💾 Save Template</button>
          <button id="btnSaveCv" class="btn btn-primary" onclick="saveCv()">💾 Save CV</button>
        </div>
      </div>

      <!-- CV Workspace (Markdown / JSON) -->
      <div id="cvWorkspace" class="workspace">
        <div class="pane">
          <div class="pane-header">
            <span id="cvEditorHeader">Markdown Source</span>
          </div>
          <textarea id="markdownEditor" spellcheck="false" placeholder="Write markdown here...">${escapeHtml(markdown)}</textarea>
          <textarea id="jsonEditor" spellcheck="false" style="display:none;" placeholder="Paste CV JSON here...">${escapeHtml(jsonData)}</textarea>
        </div>
        <div class="pane">
          <div class="pane-header">
            <span>Live Output Preview</span>
          </div>
          <iframe id="previewFrame" src="about:blank"></iframe>
        </div>
      </div>

      <!-- Template Studio Workspace -->
      <div id="templateWorkspace" class="workspace" style="display:none;">
        <div class="pane">
          <div class="pane-header">
            <span>EJS Template Code: <code id="templateHeaderId" style="color:#2b6cb0;">${activeTemplateId}</code></span>
            <span style="font-size:11px;color:#718096;">Variables: <code style="color:#2b6cb0;">cv, name, headline, summary, contact, workExperience...</code></span>
          </div>
          <div class="hint-bar">
            💡 <strong>EJS Templater:</strong> Customize HTML structure, Markdown format, or JSON output. Live preview updates automatically using current CV data.
          </div>
          <textarea id="templateEditor" spellcheck="false" placeholder="Write EJS template here...">${escapeHtml(activeTemplateContent)}</textarea>
        </div>
        <div class="pane">
          <div class="pane-header">
            <span id="templatePreviewHeader">Template Render Output Preview</span>
          </div>
          <iframe id="templatePreviewFrame" src="about:blank" style="display:block;"></iframe>
          <pre id="templatePreviewCode" class="preview-code" style="display:none;"></pre>
        </div>
      </div>
    </div>
  </div>

  <script>
    const currentId = '${editId}';
    let currentTab = 'md';
    let currentTemplateId = '${activeTemplateId}';

    function switchTab(tab) {
      currentTab = tab;
      const mdEditor = document.getElementById('markdownEditor');
      const jsonEditor = document.getElementById('jsonEditor');
      const tabMd = document.getElementById('tabMd');
      const tabJson = document.getElementById('tabJson');
      const tabTemplate = document.getElementById('tabTemplate');
      const btnConvert = document.getElementById('btnConvert');
      const btnSaveCv = document.getElementById('btnSaveCv');
      const btnSaveTemplate = document.getElementById('btnSaveTemplate');
      const btnApplyTemplate = document.getElementById('btnApplyTemplate');
      const cvWorkspace = document.getElementById('cvWorkspace');
      const templateWorkspace = document.getElementById('templateWorkspace');
      const cvEditorHeader = document.getElementById('cvEditorHeader');

      // Reset active tabs
      tabMd.classList.remove('active');
      tabJson.classList.remove('active');
      tabTemplate.classList.remove('active');

      if (tab === 'md') {
        cvWorkspace.style.display = 'flex';
        templateWorkspace.style.display = 'none';
        mdEditor.style.display = 'block';
        jsonEditor.style.display = 'none';
        tabMd.classList.add('active');
        btnConvert.style.display = 'none';
        btnApplyTemplate.style.display = 'none';
        btnSaveTemplate.style.display = 'none';
        btnSaveCv.style.display = 'inline-flex';
        cvEditorHeader.textContent = 'Markdown Source';
        updatePreview();
      } else if (tab === 'json') {
        cvWorkspace.style.display = 'flex';
        templateWorkspace.style.display = 'none';
        mdEditor.style.display = 'none';
        jsonEditor.style.display = 'block';
        tabJson.classList.add('active');
        btnConvert.style.display = 'inline-flex';
        btnApplyTemplate.style.display = 'none';
        btnSaveTemplate.style.display = 'none';
        btnSaveCv.style.display = 'inline-flex';
        cvEditorHeader.textContent = 'CV JSON Data (Schema-Compliant)';
      } else if (tab === 'template') {
        cvWorkspace.style.display = 'none';
        templateWorkspace.style.display = 'flex';
        tabTemplate.classList.add('active');
        btnConvert.style.display = 'none';
        btnApplyTemplate.style.display = 'inline-flex';
        btnSaveTemplate.style.display = 'inline-flex';
        btnSaveCv.style.display = 'none';
        updateTemplatePreview();
      }
    }

    // -------------------------------------------------------------
    // TEMPLATE MANAGEMENT
    // -------------------------------------------------------------
    async function selectTemplate(templateId) {
      currentTemplateId = templateId;
      document.getElementById('activeTemplateBadge').textContent = templateId;
      document.getElementById('templateHeaderId').textContent = templateId;

      try {
        const res = await fetch('/api/templates/' + templateId);
        const data = await res.json();
        if (data.content !== undefined) {
          document.getElementById('templateEditor').value = data.content;
          switchTab('template');
          updateTemplatePreview();
        }
      } catch (e) {
        alert('Error loading template: ' + e.message);
      }
    }

    async function saveTemplate() {
      const content = document.getElementById('templateEditor').value;
      try {
        const res = await fetch('/api/templates/' + currentTemplateId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
          alert('Template saved successfully!');
          updatePreview();
        } else {
          alert('Error saving template: ' + (data.error || 'Unknown error'));
        }
      } catch (e) {
        alert('Error saving template: ' + e.message);
      }
    }

    async function resetTemplate(templateId) {
      if (!confirm('Reset template ' + templateId + ' to system default?')) return;
      try {
        const res = await fetch('/api/templates/' + templateId + '/reset', {
          method: 'POST'
        });
        const data = await res.json();
        if (data.success) {
          alert('Template reset to default.');
          window.location.reload();
        }
      } catch (e) {
        alert('Error resetting template: ' + e.message);
      }
    }

    let templateDebounce = null;
    function updateTemplatePreview() {
      clearTimeout(templateDebounce);
      templateDebounce = setTimeout(async () => {
        const templateContent = document.getElementById('templateEditor').value;
        const markdown = document.getElementById('markdownEditor').value;
        const jsonText = document.getElementById('jsonEditor').value;
        let jsonData = null;
        if (jsonText.trim()) {
          try { jsonData = JSON.parse(jsonText); } catch (e) {}
        }

        try {
          const res = await fetch('/api/templates/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              templateId: currentTemplateId,
              templateContent,
              markdown,
              jsonData
            })
          });
          const data = await res.json();

          const frame = document.getElementById('templatePreviewFrame');
          const codeEl = document.getElementById('templatePreviewCode');
          const header = document.getElementById('templatePreviewHeader');

          if (data.type === 'html') {
            frame.style.display = 'block';
            codeEl.style.display = 'none';
            header.textContent = 'Rendered HTML Output Preview';
            const doc = frame.contentWindow.document;
            doc.open();
            doc.write(data.rendered);
            doc.close();
          } else {
            frame.style.display = 'none';
            codeEl.style.display = 'block';
            header.textContent = 'Rendered ' + data.type.toUpperCase() + ' Output Preview';
            codeEl.textContent = data.rendered;
          }
        } catch (e) {
          console.error(e);
        }
      }, 300);
    }

    document.getElementById('templateEditor').addEventListener('input', updateTemplatePreview);

    // Apply template directly to the Markdown or JSON editor
    async function applyTemplateToCv() {
      const templateContent = document.getElementById('templateEditor').value;
      const jsonText = document.getElementById('jsonEditor').value;
      let jsonData = null;
      if (jsonText.trim()) {
        try { jsonData = JSON.parse(jsonText); } catch (e) {}
      }

      if (!jsonData) {
        alert('Please provide valid JSON data in the JSON Data tab to render template.');
        return;
      }

      try {
        const res = await fetch('/api/templates/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateId: currentTemplateId,
            templateContent,
            jsonData
          })
        });
        const data = await res.json();
        if (data.type === 'md') {
          document.getElementById('markdownEditor').value = data.rendered;
          switchTab('md');
          updatePreview();
          alert('Template rendered to Markdown Editor!');
        } else if (data.type === 'json') {
          document.getElementById('jsonEditor').value = data.rendered;
          switchTab('json');
          alert('Template rendered to JSON Editor!');
        } else {
          alert('HTML template affects live rendering on save/preview!');
        }
      } catch (e) {
        alert('Error applying template: ' + e.message);
      }
    }

    // -------------------------------------------------------------
    // CV WORKSPACE LOGIC
    // -------------------------------------------------------------
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
}

module.exports = {
  renderAdminPage
};
