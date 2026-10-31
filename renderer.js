const { marked } = require('marked');

marked.setOptions({
  gfm: true,
  breaks: true
});

function inlineMarkdown(text) {
  if (!text) return '';
  return marked.parseInline(text.trim());
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

function extractTitleAndJsonLd(markdown) {
  let title = "Curriculum Vitae";
  let name = "";
  let jobTitle = "";
  let email = "";
  let telephone = "";
  let address = "";
  let linkedin = "";
  let github = "";

  const lines = (markdown || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!name && trimmed.startsWith('# ')) {
      name = trimmed.replace(/^#\s+/, '').trim();
    } else if (!jobTitle && trimmed.startsWith('## ') && !trimmed.toLowerCase().includes('work experience') && !trimmed.toLowerCase().includes('skills')) {
      jobTitle = trimmed.replace(/^##\s+/, '').trim();
    }
    
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

function parseCvMarkdown(markdown) {
  const text = (markdown || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  
  let name = '';
  let title = '';
  const introLines = [];
  const contacts = [];
  
  let lineIdx = 0;
  
  // 1. Find H1 name
  while (lineIdx < lines.length) {
    const trimmed = lines[lineIdx].trim();
    if (trimmed.startsWith('# ')) {
      name = trimmed.replace(/^#\s+/, '').trim();
      lineIdx++;
      break;
    }
    lineIdx++;
  }
  
  // 2. Find H2 title/role
  while (lineIdx < lines.length) {
    const trimmed = lines[lineIdx].trim();
    if (trimmed.startsWith('## ') && !trimmed.toLowerCase().includes('experience') && !trimmed.toLowerCase().includes('skills') && !trimmed.toLowerCase().includes('contact') && !trimmed.toLowerCase().includes('languages') && !trimmed.toLowerCase().includes('education')) {
      title = trimmed.replace(/^##\s+/, '').trim();
      lineIdx++;
      break;
    }
    lineIdx++;
  }
  
  // 3. Collect intro and contacts before first major section
  let inContacts = false;
  for (; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const trimmed = rawLine.trim();
    
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      break;
    }
    
    if (trimmed.startsWith('### Contact') || trimmed.toLowerCase().includes('contact information')) {
      inContacts = true;
      continue;
    }
    
    if (inContacts) {
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        contacts.push(trimmed.replace(/^[-*]\s+/, '').trim());
      }
    } else {
      if (trimmed === '---') continue;
      if (trimmed) introLines.push(trimmed);
    }
  }
  
  const intro = introLines.join(' ').trim();
  
  // 4. Collect all subsequent sections
  const sections = [];
  let currentSection = null;
  
  for (; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const trimmed = rawLine.trim();
    
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: trimmed.replace(/^##\s+/, '').trim(),
        lines: []
      };
    } else {
      if (trimmed === '---') continue;
      if (currentSection) {
        currentSection.lines.push(rawLine);
      }
    }
  }
  if (currentSection) {
    sections.push(currentSection);
  }
  
  return { name, title, intro, contacts, sections };
}

function renderContactsHtml(contacts) {
  return contacts.map(c => {
    const linkMatch = c.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const prefix = c.substring(0, linkMatch.index).trim();
      const label = linkMatch[1];
      const url = linkMatch[2];
      
      const cleanPrefix = prefix.replace(/:\s*$/, '').trim().toLowerCase();
      if (cleanPrefix === 'telegram') {
        const handle = label.replace(/^@/, '');
        return `<p>telegram: <a href="${url}" target="_blank">${handle}</a></p>`;
      }
      if (cleanPrefix === 'email' || cleanPrefix === 'phone') {
        return `<p><a href="${url}" target="_blank">${label}</a></p>`;
      }
      if (cleanPrefix === 'location') {
        let locText = label;
        if (locText.includes('Barcelona, Spain')) {
          locText = 'Terrassa, Barcelona<br />Spain';
        }
        return `<p><a href="${url}" target="_blank">${locText}</a></p>`;
      }
      if (prefix) {
        return `<p>${prefix} <a href="${url}" target="_blank">${label}</a></p>`;
      }
      return `<p><a href="${url}" target="_blank">${label}</a></p>`;
    }
    return `<p>${inlineMarkdown(c)}</p>`;
  }).join('\n          ');
}

function renderWorkExperienceHtml(lines) {
  const jobs = [];
  let currentJob = null;
  
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('### ')) {
      if (currentJob) jobs.push(currentJob);
      currentJob = {
        headerLine: trimmed.replace(/^###\s+/, '').trim(),
        datesLine: '',
        introText: '',
        achievements: []
      };
      continue;
    }
    
    if (!currentJob) continue;
    
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentJob.achievements.push(trimmed.replace(/^[-*]\s+/, '').trim());
    } else if (trimmed.includes('(') && trimmed.includes(')') && !currentJob.datesLine && !currentJob.introText && currentJob.achievements.length === 0) {
      currentJob.datesLine = trimmed;
    } else {
      if (currentJob.introText) currentJob.introText += ' ' + trimmed;
      else currentJob.introText = trimmed;
    }
  }
  if (currentJob) jobs.push(currentJob);
  
  return jobs.map(job => {
    let role = job.headerLine;
    let companyHtml = '';
    
    if (job.headerLine.includes(' - ')) {
      const parts = job.headerLine.split(' - ');
      role = parts[0].trim();
      const companyPart = parts.slice(1).join(' - ').trim();
      const compLink = companyPart.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (compLink) {
        companyHtml = `<a href="${compLink[2]}" target="_blank"\n            class="job-company">${compLink[1]}</a>`;
      } else {
        companyHtml = `<span class="job-company">${companyPart}</span>`;
      }
    } else {
      role = job.headerLine;
    }
    
    let datesText = '';
    let placeText = '';
    
    const datesMatch = job.datesLine.match(/\(([^)]+)\)/);
    if (datesMatch) {
      datesText = `(${datesMatch[1]})`;
    }
    const cleanedDatesLine = job.datesLine.replace(/\([^)]+\)/, '').replace(/[*_]/g, '').trim();
    if (cleanedDatesLine) {
      placeText = cleanedDatesLine;
    }
    
    let subHeader = '';
    if (datesText || placeText) {
      subHeader = `\n          <br />${datesText ? `<span class="job-dates">${datesText}</span>` : ''} ${placeText ? `<i class="job-place">${placeText}</i>` : ''}`;
    }
    
    let out = `        <h3 class="job-header">${role}${companyHtml ? ' - ' + companyHtml : ''}${subHeader}\n        </h3>`;
    
    if (job.introText) {
      out += `\n        <p>${inlineMarkdown(job.introText)}</p>`;
    }
    
    if (job.achievements.length > 0) {
      out += `\n        <ul class="achievements">\n`;
      out += job.achievements.map(a => `          <li>${inlineMarkdown(a)}</li>`).join('\n');
      out += `\n        </ul>`;
    }
    
    return out;
  }).join('\n\n');
}

function renderSkillsHtml(lines) {
  const badges = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      badges.push(trimmed.replace(/^[-*]\s+/, '').trim());
    } else {
      const items = trimmed.split(',');
      for (const item of items) {
        if (item.trim()) badges.push(item.trim());
      }
    }
  }
  
  return `        <div class="skills">\n` +
    badges.map(b => `          <div class="skill-badge">${inlineMarkdown(b)}</div>`).join('\n') +
    `\n        </div>`;
}

function renderLanguagesHtml(lines) {
  const items = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      items.push(trimmed.replace(/^[-*]\s+/, '').trim());
    } else {
      items.push(trimmed);
    }
  }
  
  return `        <div class="skills">\n` +
    items.map(lang => `          <div class="skill-badge">${inlineMarkdown(lang)}</div>`).join('\n') +
    `\n        </div>`;
}

function renderEducationHtml(lines) {
  const cleanLines = lines.map(l => l.trim()).filter(Boolean);
  if (cleanLines.length === 0) return '';
  
  const first = cleanLines[0];
  const rest = cleanLines.slice(1);
  
  let formatted = `<p><b>${first.replace(/\*\*/g, '')}</b>`;
  if (rest.length > 0) {
    formatted += `<br>${rest.map(r => inlineMarkdown(r)).join('<br>')}`;
  }
  formatted += `</p>`;
  return '        ' + formatted;
}

function renderVolunteerHtml(lines) {
  const items = [];
  let currentItem = null;
  
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('### ')) {
      if (currentItem) items.push(currentItem);
      currentItem = {
        title: trimmed.replace(/^###\s+/, '').trim(),
        role: '',
        datesLine: '',
        achievements: []
      };
      continue;
    }
    
    if (!currentItem) continue;
    
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentItem.achievements.push(trimmed.replace(/^[-*]\s+/, '').trim());
    } else if (trimmed.includes('(') && trimmed.includes(')')) {
      currentItem.datesLine = trimmed;
    } else if (!currentItem.role) {
      currentItem.role = trimmed;
    }
  }
  if (currentItem) items.push(currentItem);
  
  return items.map(v => {
    let out = `        <h3 class="job-header">${inlineMarkdown(v.title)}</h3>`;
    if (v.role) {
      out += `\n        <div class="job-company">${inlineMarkdown(v.role)}</div>`;
    }
    if (v.datesLine) {
      const datesMatch = v.datesLine.match(/\(([^)]+)\)/);
      const placeMatch = v.datesLine.replace(/\([^)]+\)/, '').replace(/[*_]/g, '').trim();
      out += `\n        <div>\n          ${datesMatch ? `<span class="job-dates">(${datesMatch[1]})</span>` : ''} ${placeMatch ? `<i class="job-place">${placeMatch}</i>` : ''}\n        </div>`;
    }
    if (v.achievements.length > 0) {
      out += `\n\n        <ul class="achievements">\n`;
      out += v.achievements.map(a => `          <li>${inlineMarkdown(a)}</li>`).join('\n');
      out += `\n        </ul>`;
    }
    return out;
  }).join('\n\n');
}

function renderGenericSection(section) {
  const contentHtml = marked.parse(section.lines.join('\n'));
  return `        <h2 class="section-title">${inlineMarkdown(section.title)}</h2>\n${contentHtml}`;
}

function renderCvHtml({ markdown, title, jsonLd, rawMdUrl, editUrl, id }) {
  const jsonLdString = typeof jsonLd === 'string' ? jsonLd : JSON.stringify(jsonLd, null, 2);
  const parsed = parseCvMarkdown(markdown || '');
  
  const pageTitle = title || (parsed.name && parsed.title ? `${parsed.name} - ${parsed.title}` : 'Curriculum Vitae');

  // Categorize sections into Left Column (Work Experience) and Right Column (Skills, Languages, Education, Volunteer, etc.)
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
  
  // Render Left Column HTML
  let leftColumnHtml = '';
  for (const sec of leftSections) {
    leftColumnHtml += `        <h2 class="section-title">${inlineMarkdown(sec.title)}</h2>\n\n`;
    leftColumnHtml += renderWorkExperienceHtml(sec.lines);
    leftColumnHtml += '\n';
  }
  
  // Render Right Column HTML
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
  
  // Contacts HTML
  const contactsHtml = renderContactsHtml(parsed.contacts);

  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <script type="application/ld+json">
${jsonLdString}
  </script>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #fff;
      color: #333;
    }

    .top-actions {
      max-width: 1000px;
      margin: 12px auto 0;
      padding: 0 20px;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .top-actions a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      font-size: 0.82rem;
      font-weight: 500;
      color: #555;
      background: #f5f5f5;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      text-decoration: none;
      transition: all 0.2s;
    }

    .top-actions a:hover {
      background: #e8e8e8;
      color: #111;
    }

    .container {
      max-width: 1000px;
      padding: 20px 20px 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      flex-wrap: nowrap;
      margin: 0 auto;
    }

    h1 {
      font-size: 2.5em;
      color: #4a4a4a;
      margin-bottom: 5px;
      margin-top: 0;
    }

    h2 {
      font-size: 1.5em;
      color: #717171;
      margin-bottom: 20px;
      font-weight: normal;
      margin-top: 0;
    }

    .main-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 45px;
    }

    .header,
    .contact-info {
      min-height: 216px;
    }

    .contact-info {
      text-align: right;
      font-size: 0.9em;
      color: #555;
    }

    .contact-info p {
      margin: 5px 0;
    }

    .contact-info a {
      color: #0077b5;
      text-decoration: none;
    }

    .section-title {
      font-size: 1.5em;
      margin-top: 45px;
      margin-bottom: 20px;
      color: #333;
      padding-bottom: 10px;
      border-bottom: 2px solid #ececec;
    }

    .section-title:first-child {
      margin-top: 0;
    }

    .skills,
    .languages {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .skill-badge::before {
      display: inline-block;
      content: ' #';
      opacity: 0.3;
    }

    .language-level {
      background-color: #f0f0f0;
      border-radius: 20px;
      padding: 8px 15px;
      font-size: 0.9em;
      color: #555;
    }

    .job {
      margin-bottom: 25px;
    }

    .job-header {
      font-size: 1.3em;
      margin-bottom: 5px;
      color: #333;
      line-height: 1;
      margin-top: 45px;
    }

    .section-title+.job-header {
      margin-top: 0;
    }

    .job-company,
    .job-company:visited,
    .job-company:active,
    .job-company:hover {
      font-size: 1em;
      color: #979797;
      text-decoration: none;
    }

    .job-company:active,
    .job-company:hover {
      text-decoration: underline;
    }

    .job-dates {
      font-style: italic;
      font-size: 0.75em;
      color: #777;
    }

    .job-place {
      font-style: italic;
      font-size: 0.75em;
    }

    .achievements {
      list-style-type: none;
      padding-left: 0;
      margin-top: 10px;
    }

    .achievements li {
      position: relative;
      padding-left: 20px;
      margin-bottom: 5px;
      text-wrap-style: pretty;
    }

    .achievements li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #4a90e2;
      font-size: 1.2em;
    }

    .languages .language-level {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .language-level p {
      margin: 0;
    }

    .language-level .dots {
      display: flex;
      gap: 5px;
    }

    .dots span {
      display: inline-block;
      width: 10px;
      height: 10px;
      background-color: #ccc;
      border-radius: 50%;
    }

    .dots .filled {
      background-color: #4a90e2;
    }

    .interests {
      margin-top: 20px;
    }

    @media print {
      .top-actions {
        display: none;
      }
    }
  </style>
</head>

<body>
  <div class="top-actions">
    ${rawMdUrl ? `<a href="${rawMdUrl}" target="_blank">📄 View Markdown (.md)</a>` : ''}
    ${editUrl ? `<a href="${editUrl}">✏️ Edit in Admin</a>` : ''}
  </div>
  <div class="container">
    <div class="main-content">
      <div>
        <div class="header">
          <h1>${inlineMarkdown(parsed.name)}</h1>
          <h2>${inlineMarkdown(parsed.title)}</h2>
          <p>${inlineMarkdown(parsed.intro)}</p>
        </div>
      </div>
      <div>
        <div class="contact-info">
          ${contactsHtml}
        </div>
      </div>
    </div>
    <div class="main-content">
      <div style="flex: 2;">
${leftColumnHtml}      </div>

      <div style="flex: 1;">
${rightColumnHtml}      </div>
    </div>
  </div>
</body>

</html>`;
}

module.exports = {
  extractTitleAndJsonLd,
  renderCvHtml,
  escapeHtml
};
