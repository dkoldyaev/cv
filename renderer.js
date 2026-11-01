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

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseCountryCode(countryStr) {
  if (!countryStr) return undefined;
  const c = countryStr.toLowerCase();
  if (c.includes('germany') || c.includes('de')) return 'DE';
  if (c.includes('israel') || c.includes('il')) return 'IL';
  if (c.includes('russia') || c.includes('ru')) return 'RU';
  if (c.includes('spain') || c.includes('es')) return 'ES';
  if (c.includes('usa') || c.includes('us') || c.includes('united states')) return 'US';
  if (c.includes('uk') || c.includes('gb') || c.includes('united kingdom')) return 'GB';
  return countryStr;
}

function parseIsoDate(dateStr) {
  if (!dateStr) return undefined;
  const myMatch = dateStr.match(/(\d{1,2})\/(\d{4})/);
  if (myMatch) {
    const month = myMatch[1].padStart(2, '0');
    const year = myMatch[2];
    return `${year}-${month}`;
  }
  const yMatch = dateStr.match(/\b(19\d\d|20\d\d)\b/);
  if (yMatch) {
    return yMatch[1];
  }
  return dateStr;
}

function extractTitleAndJsonLd(markdown) {
  const parsed = parseCvMarkdown(markdown);
  const name = parsed.name || "Dmitry Koldyaev";
  const jobTitle = parsed.title || "Frontend Developer";
  const intro = parsed.intro || "";

  // Split name into given and family
  const nameParts = name.trim().split(/\s+/);
  const givenName = nameParts[0] || "";
  const familyName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : "";

  // Parse contacts
  let email = "";
  let telephone = "";
  let locationName = "";
  let locationAddress = null;
  const sameAs = [];
  const contactPoints = [];

  for (const c of parsed.contacts) {
    const linkMatch = c.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const text = c;
    const label = linkMatch ? linkMatch[1] : text;
    const href = linkMatch ? linkMatch[2] : text;

    if (text.toLowerCase().includes('email') || href.startsWith('mailto:') || text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)) {
      const emailMatch = href.replace(/^mailto:/, '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || label.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch && !email) email = emailMatch[0];
    } else if (text.toLowerCase().includes('phone') || href.startsWith('tel:') || text.match(/\+\d[\d\s-]{7,}\d/)) {
      const phoneClean = (href.replace(/^tel:/, '').match(/\+\d[\d\s-]{7,}\d/) || label.match(/\+\d[\d\s-]{7,}\d/));
      if (phoneClean && !telephone) telephone = phoneClean[0].replace(/[\s-]/g, '');
    } else if (text.toLowerCase().includes('location') || text.toLowerCase().includes('barcelona') || text.toLowerCase().includes('spain')) {
      locationName = label;
      if (label.includes('Terrassa') && label.includes('Spain')) {
        locationAddress = {
          "@type": "PostalAddress",
          "addressLocality": "Terrassa",
          "addressRegion": "Barcelona",
          "addressCountry": "ES"
        };
      } else {
        const parts = label.split(',').map(p => p.trim());
        locationAddress = {
          "@type": "PostalAddress",
          "addressLocality": parts[0] || "",
          "addressCountry": parts.length > 1 ? parseCountryCode(parts[parts.length - 1]) : ""
        };
      }
    } else if (text.toLowerCase().includes('telegram') || href.includes('t.me/')) {
      sameAs.push(href);
      contactPoints.push({
        "@type": "ContactPoint",
        "contactType": "Telegram",
        "url": href
      });
    } else if (text.toLowerCase().includes('linkedin') || href.includes('linkedin.com')) {
      sameAs.push(href);
    } else if (text.toLowerCase().includes('github') || href.includes('github.com')) {
      sameAs.push(href);
    }
  }

  // Parse Languages
  const languagesSection = parsed.sections.find(s => s.title.toLowerCase().includes('language'));
  const knowsLanguage = [];
  const availableLanguages = [];
  if (languagesSection) {
    for (const l of languagesSection.lines) {
      const trimmed = l.trim().replace(/^[-*]\s+/, '');
      if (!trimmed) continue;
      const langItems = trimmed.split(',');
      for (const item of langItems) {
        const langName = item.trim();
        if (langName) {
          availableLanguages.push(langName);
          let code = 'en';
          if (langName.toLowerCase().includes('russ')) code = 'ru';
          else if (langName.toLowerCase().includes('span')) code = 'es';
          else if (langName.toLowerCase().includes('germ')) code = 'de';
          else if (langName.toLowerCase().includes('fren')) code = 'fr';
          knowsLanguage.push({
            "@type": "Language",
            "name": langName,
            "alternateName": code
          });
        }
      }
    }
  }

  if (email || telephone) {
    const cp = {
      "@type": "ContactPoint",
      "contactType": "professional inquiries"
    };
    if (email) cp.email = email;
    if (telephone) cp.telephone = telephone;
    if (availableLanguages.length > 0) cp.availableLanguage = availableLanguages;
    contactPoints.unshift(cp);
  }

  // Parse Skills
  const skillsSection = parsed.sections.find(s => s.title.toLowerCase().includes('skill'));
  const allSkills = [];
  if (skillsSection) {
    for (const l of skillsSection.lines) {
      const trimmed = l.trim().replace(/^[-*]\s+/, '');
      if (!trimmed) continue;
      allSkills.push(trimmed);
    }
  }

  // Work Experience
  const workSection = parsed.sections.find(s => s.title.toLowerCase().includes('work') || s.title.toLowerCase().includes('experience'));
  const orgEntities = [];
  const roleEntities = [];
  const jobTitlesSet = new Set();
  if (jobTitle) jobTitlesSet.add(jobTitle);

  if (workSection) {
    const rawJobs = [];
    let curJob = null;
    for (const line of workSection.lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('### ')) {
        if (curJob) rawJobs.push(curJob);
        curJob = { header: trimmed.replace(/^###\s+/, ''), datesLine: '', intro: '', achievements: [] };
        continue;
      }
      if (!curJob) continue;
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        curJob.achievements.push(trimmed.replace(/^[-*]\s+/, ''));
      } else if (trimmed.includes('(') && trimmed.includes(')') && !curJob.datesLine && !curJob.intro && !curJob.achievements.length) {
        curJob.datesLine = trimmed;
      } else {
        if (curJob.intro) curJob.intro += ' ' + trimmed;
        else curJob.intro = trimmed;
      }
    }
    if (curJob) rawJobs.push(curJob);

    for (const j of rawJobs) {
      let rName = j.header;
      let compName = "";
      let compUrl = "";
      if (j.header.includes(' - ')) {
        const p = j.header.split(' - ');
        rName = p[0].trim();
        const cPart = p.slice(1).join(' - ').trim();
        const m = cPart.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (m) {
          compName = m[1];
          compUrl = m[2];
        } else {
          compName = cPart;
        }
      }
      jobTitlesSet.add(rName);

      let sDate = "";
      let eDate = "";
      let place = "";
      const datesMatch = j.datesLine.match(/\(([^)]+)\)/);
      if (datesMatch) {
        const dParts = datesMatch[1].split('-').map(s => s.trim());
        if (dParts.length > 0) sDate = parseIsoDate(dParts[0]);
        if (dParts.length > 1) eDate = parseIsoDate(dParts[1]);
      }
      const placeMatch = j.datesLine.replace(/\([^)]+\)/, '').replace(/[*_]/g, '').trim();
      if (placeMatch) place = placeMatch;

      const compSlug = slugify(compName.replace(/\(.*?\)/g, ''));
      const orgId = `#org-${compSlug}`;
      const roleId = `#role-${compSlug}`;

      const orgObj = {
        "@type": "Organization",
        "@id": orgId,
        "name": compName
      };
      if (place) {
        orgObj.location = {
          "@type": "Place",
          "address": {
            "@type": "PostalAddress",
            "addressCountry": parseCountryCode(place)
          }
        };
      }
      if (compUrl) {
        orgObj.url = compUrl;
      }
      orgEntities.push(orgObj);

      let desc = j.intro ? j.intro : '';
      if (j.achievements.length > 0) {
        if (desc) desc += ' ';
        desc += `Responsibilities and achievements: ${j.achievements.join(' ')}`;
      }

      const roleObj = {
        "@type": "EmployeeRole",
        "@id": roleId,
        "roleName": rName,
        "memberOf": { "@id": orgId },
        "about": { "@id": "#person" }
      };
      if (sDate) roleObj.startDate = sDate;
      if (eDate) roleObj.endDate = eDate;
      if (desc) roleObj.description = desc;

      roleEntities.push(roleObj);
    }
  }

  // Education
  const eduSection = parsed.sections.find(s => s.title.toLowerCase().includes('education'));
  let universityEntity = null;
  let studyRoleEntity = null;
  if (eduSection) {
    const cleanLines = eduSection.lines.map(l => l.trim()).filter(Boolean);
    let studyTitle = cleanLines[0] ? cleanLines[0].replace(/\*\*/g, '') : "Mathematics and Mechanics";
    let uniName = "Ural State University";
    let sYear = "2005";
    let eYear = "2008";
    let city = "Yekaterinburg";

    for (const l of cleanLines) {
      const yearMatch = l.match(/\b(19\d\d|20\d\d)\s*[-–]\s*(19\d\d|20\d\d)\b/);
      if (yearMatch) {
        sYear = yearMatch[1];
        eYear = yearMatch[2];
        const uPart = l.replace(yearMatch[0], '').replace(/[-–]/g, '').trim();
        if (uPart) uniName = uPart;
      } else if (!l.includes('**') && l.length < 30) {
        city = l;
      }
    }

    universityEntity = {
      "@type": "CollegeOrUniversity",
      "@id": "#university",
      "name": uniName,
      "address": {
        "@type": "PostalAddress",
        "addressLocality": city,
        "addressCountry": "RU"
      }
    };

    studyRoleEntity = {
      "@type": "OrganizationRole",
      "@id": "#university-study",
      "alumniOf": { "@id": "#university" },
      "startDate": sYear,
      "endDate": eYear,
      "description": `${studyTitle} studies. Degree completion not stated.`
    };
  }

  // Volunteer
  const volSection = parsed.sections.find(s => s.title.toLowerCase().includes('volunteer'));
  let volOrgEntity = null;
  let volRoleEntity = null;
  if (volSection) {
    let volTitle = "Biennial of Contemporary Art";
    let volRole = "Installer and Artist's Assistant (Volunteer)";
    let sYear = "2012";
    let eYear = "2019";
    const volAch = [];

    for (const l of volSection.lines) {
      const trimmed = l.trim();
      if (trimmed.startsWith('### ')) volTitle = trimmed.replace(/^###\s+/, '');
      else if (trimmed.includes('(') && trimmed.includes(')')) {
        const ym = trimmed.match(/\b(19\d\d|20\d\d)\s*[-–]\s*(19\d\d|20\d\d)\b/);
        if (ym) {
          sYear = ym[1];
          eYear = ym[2];
        }
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        volAch.push(trimmed.replace(/^[-*]\s+/, ''));
      } else if (!volAch.length && trimmed) {
        volRole = `${trimmed} (Volunteer)`;
      }
    }

    volOrgEntity = {
      "@type": "Organization",
      "@id": "#volunteer-organization",
      "name": volTitle,
      "description": `${volTitle} in Yekaterinburg, Russia, where ${name} volunteered from ${sYear} to ${eYear}.`
    };

    volRoleEntity = {
      "@type": "OrganizationRole",
      "@id": "#volunteer-role",
      "memberOf": { "@id": "#volunteer-organization" },
      "startDate": sYear,
      "endDate": eYear,
      "roleName": volRole,
      "description": volAch.length > 0 ? volAch.join(' ') : "Assisted exhibition installation and artists and guided accessibility-oriented tours.",
      "about": { "@id": "#person" }
    };
  }

  // Person Entity
  const personEntity = {
    "@type": "Person",
    "@id": "#person",
    "name": name,
    "givenName": givenName,
    "familyName": familyName,
    "alternateName": "Дмитрий Кольдяев",
    "mainEntityOfPage": { "@id": "#webpage" },
    "jobTitle": Array.from(jobTitlesSet),
    "description": intro || `${jobTitle} with commercial experience.`,
    "email": email,
    "telephone": telephone,
    "sameAs": sameAs,
    "homeLocation": {
      "@type": "Place",
      "name": locationName || "Terrassa, Barcelona, Spain",
      "address": locationAddress || {
        "@type": "PostalAddress",
        "addressLocality": "Terrassa",
        "addressRegion": "Barcelona",
        "addressCountry": "ES"
      }
    },
    "contactPoint": contactPoints,
    "hasOccupation": [
      {
        "@type": "Occupation",
        "name": "Frontend Developer",
        "description": "Development of user interfaces, client-side web applications, reusable design systems, and high-performance React and Next.js products.",
        "skills": allSkills
      },
      {
        "@type": "Occupation",
        "name": "Full Stack Developer",
        "description": "Development and maintenance of frontend, backend, integration and deployment infrastructure.",
        "skills": [
          "PHP",
          "Symfony",
          "Python",
          "Django",
          "FastAPI",
          "PostgreSQL",
          "MySQL",
          "Redis",
          "Mercure"
        ]
      }
    ],
    "skills": allSkills,
    "knowsAbout": [
      "Front-end development",
      "Full-stack web development",
      "Single-page applications (SPA)",
      "Progressive web applications (PWA)",
      "Server-side rendering (SSR)",
      "Static site generation (SSG)",
      "Incremental static regeneration (ISR)",
      "Search engine optimization (SEO)",
      "Web performance optimization",
      "Microfrontend architecture",
      "Design systems and UI component libraries",
      "Automated unit and integration testing",
      "Visual regression testing",
      "Continuous integration and continuous deployment",
      "No-code and low-code editors",
      "Drag-and-drop interfaces",
      "Real-time data synchronization",
      "Legacy application modernization",
      "Web application security",
      "Technical collaboration in Scrum teams"
    ],
    "knowsLanguage": knowsLanguage
  };

  if (universityEntity) {
    personEntity.alumniOf = { "@id": "#university" };
  }
  if (volOrgEntity) {
    personEntity.memberOf = { "@id": "#volunteer-organization" };
  }

  // WebSite & WebPage entities
  const websiteEntity = {
    "@type": "WebSite",
    "@id": "#website",
    "name": `${name} — CV and Portfolio`,
    "inLanguage": "en",
    "publisher": { "@id": "#person" }
  };

  const webpageEntity = {
    "@type": ["WebPage", "ProfilePage"],
    "@id": "#webpage",
    "name": `${name} — ${jobTitle}`,
    "description": `Professional CV of ${name}, a ${jobTitle.toLowerCase()} and full-stack developer with more than 10 years of commercial experience. Includes work history, technical skills, education, languages and volunteering.`,
    "inLanguage": "en",
    "isPartOf": { "@id": "#website" },
    "mainEntity": { "@id": "#person" },
    "about": { "@id": "#person" }
  };

  const graph = [
    websiteEntity,
    webpageEntity,
    personEntity
  ];

  if (universityEntity) graph.push(universityEntity);
  if (volOrgEntity) graph.push(volOrgEntity);
  graph.push(...orgEntities);
  graph.push(...roleEntities);
  if (studyRoleEntity) graph.push(studyRoleEntity);
  if (volRoleEntity) graph.push(volRoleEntity);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": graph
  };

  const pageTitle = name && jobTitle ? `${name} - ${jobTitle}` : name || "Curriculum Vitae";
  return { title: pageTitle, jsonLd };
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

function renderCvHtml({ markdown, title, jsonLd, rawMdUrl, pdfUrl, jsonUrl, editUrl, id, showAdmin = false }) {
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
        display: none !important;
      }
    }
  </style>
</head>

<body>
  <div class="top-actions">
    ${pdfUrl ? `<a href="${pdfUrl}" target="_blank">📥 PDF</a>` : ''}
    ${rawMdUrl ? `<a href="${rawMdUrl}" target="_blank">📄 Markdown</a>` : ''}
    ${jsonUrl ? `<a href="${jsonUrl}" target="_blank">{ } JSON</a>` : ''}
    ${(showAdmin && editUrl) ? `<a href="${editUrl}">✏️ Edit in Admin</a>` : ''}
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
  escapeHtml,
  parseCvMarkdown,
  parseIsoDate,
  parseCountryCode,
  slugify,
  inlineMarkdown,
  renderWorkExperienceHtml,
  renderSkillsHtml,
  renderLanguagesHtml,
  renderEducationHtml,
  renderVolunteerHtml,
  renderContactsHtml
};
