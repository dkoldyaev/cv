const { marked } = require('marked');

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: true
});

function extractTitleAndJsonLd(markdown) {
  let title = "Curriculum Vitae";
  let name = "";
  let jobTitle = "";
  let email = "";
  let telephone = "";
  let address = "";
  let linkedin = "";
  let github = "";

  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!name && trimmed.startsWith('# ')) {
      name = trimmed.replace(/^#\s+/, '').trim();
    } else if (!jobTitle && trimmed.startsWith('## ') && !trimmed.toLowerCase().includes('work experience')) {
      jobTitle = trimmed.replace(/^##\s+/, '').trim();
    }
    
    // Look for contact info patterns
    const emailMatch = trimmed.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (!email && emailMatch) email = emailMatch[1];

    const phoneMatch = trimmed.match(/(\+\d[\d\s-]{7,}\d)/);
    if (!telephone && phoneMatch) telephone = phoneMatch[1];

    const linkedinMatch = trimmed.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-_]+/);
    if (!linkedin && linkedinMatch) linkedin = linkedinMatch[0];

    const githubMatch = trimmed.match(/https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9-_]+/);
    if (!github && githubMatch) github = githubMatch[0];
  }

  if (name && jobTitle) {
    title = `${name} - ${jobTitle}`;
  } else if (name) {
    title = name;
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": name || "Candidate",
    "jobTitle": jobTitle || "Professional"
  };

  if (email) jsonLd.email = `mailto:${email}`;
  if (telephone) jsonLd.telephone = telephone;
  const sameAs = [];
  if (linkedin) sameAs.push(linkedin);
  if (github) sameAs.push(github);
  if (sameAs.length > 0) jsonLd.sameAs = sameAs;

  return { title, jsonLd };
}

function renderCvHtml({ title, bodyHtml, jsonLd, rawMdUrl, editUrl, id }) {
  const jsonLdString = typeof jsonLd === 'string' ? jsonLd : JSON.stringify(jsonLd, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script type="application/ld+json">
${jsonLdString}
  </script>
  <style>
    :root {
      --primary: #4a90e2;
      --text: #333333;
      --text-muted: #666666;
      --bg: #ffffff;
      --border: #ececec;
      --badge-bg: #f5f7fa;
      --badge-text: #4a5568;
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }

    .top-actions {
      max-width: 950px;
      margin: 20px auto 0;
      padding: 0 20px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    .top-actions a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 0.85rem;
      font-weight: 500;
      color: #4a5568;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      text-decoration: none;
      transition: all 0.2s;
    }

    .top-actions a:hover {
      background: #e2e8f0;
      color: #1a202c;
    }

    .container {
      max-width: 950px;
      margin: 0 auto;
      padding: 30px 20px 60px;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      color: #2d3748;
      margin: 0 0 4px 0;
      letter-spacing: -0.5px;
    }

    h2 {
      font-size: 1.4rem;
      font-weight: 500;
      color: #718096;
      margin-top: 0;
      margin-bottom: 24px;
    }

    h3 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #2d3748;
      margin-top: 28px;
      margin-bottom: 8px;
    }

    h4 {
      font-size: 1.05rem;
      margin: 16px 0 6px;
    }

    p {
      margin: 0 0 16px;
      color: #4a5568;
    }

    a {
      color: #0077b5;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    hr {
      border: none;
      border-top: 2px solid var(--border);
      margin: 32px 0;
    }

    ul {
      padding-left: 20px;
      margin: 10px 0 20px;
    }

    li {
      margin-bottom: 8px;
      color: #4a5568;
    }

    li::marker {
      color: var(--primary);
    }

    blockquote {
      border-left: 4px solid var(--primary);
      margin: 16px 0;
      padding: 8px 16px;
      background: #f8fafc;
      color: #4a5568;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
      background: #edf2f7;
      padding: 2px 6px;
      border-radius: 4px;
    }

    pre code {
      display: block;
      padding: 12px;
      overflow-x: auto;
      background: #2d3748;
      color: #edf2f7;
      border-radius: 6px;
    }

    @media print {
      .top-actions {
        display: none;
      }
      .container {
        padding: 0;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="top-actions">
    ${rawMdUrl ? `<a href="${rawMdUrl}" target="_blank">📄 View Markdown (.md)</a>` : ''}
    ${editUrl ? `<a href="${editUrl}">✏️ Edit in Admin</a>` : ''}
  </div>
  <div class="container cv-body">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  extractTitleAndJsonLd,
  renderCvHtml,
  escapeHtml
};
