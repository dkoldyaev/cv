function formatMonth(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})$/);
  if (m) {
    return `${m[2]}/${m[1]}`;
  }
  return dateStr;
}

function jsonToMarkdown(data) {
  if (!data) return '';

  let md = `# ${data.name || ''}\n`;
  if (data.headline) {
    md += `## ${data.headline}\n\n`;
  } else {
    md += `\n`;
  }

  if (data.summary) {
    md += `${data.summary.trim()}\n\n`;
  }

  // Contact Information
  if (data.contact) {
    md += `### Contact Information\n`;
    const c = data.contact;
    if (c.email) {
      md += `- Email: [${c.email}](mailto:${c.email})\n`;
    }
    if (c.phone) {
      const cleanPhone = c.phone.replace(/[\s-]/g, '');
      md += `- Phone: [${c.phone}](tel:${cleanPhone})\n`;
    }
    if (c.location) {
      const locParts = [c.location.city, c.location.region, c.location.country].filter(Boolean);
      const locStr = locParts.join(', ');
      if (locStr) {
        md += `- Location: [${locStr}](https://maps.google.com)\n`;
      }
    }
    if (Array.isArray(c.links)) {
      for (const link of c.links) {
        if (link.label && link.url) {
          if (link.label.toLowerCase() === 'telegram') {
            const handle = link.url.replace(/^https?:\/\/t\.me\//, '@');
            md += `- Telegram: [${handle}](${link.url})\n`;
          } else if (link.label.toLowerCase() === 'linkedin') {
            md += `- LinkedIn: [LinkedIn Profile](${link.url})\n`;
          } else {
            md += `- ${link.label}: [${link.label} Profile](${link.url})\n`;
          }
        }
      }
    }
    md += `\n---\n\n`;
  }

  // Work Experience
  if (Array.isArray(data.workExperience) && data.workExperience.length > 0) {
    md += `## Work Experience\n\n`;
    for (const job of data.workExperience) {
      let companyText = job.company?.name || '';
      if (job.company?.url) {
        companyText = `[${job.company.name}](${job.company.url})`;
      }
      if (job.employmentType === 'freelance') {
        companyText += ' (freelance)';
      }
      md += `### ${job.title} - ${companyText}\n`;

      const start = formatMonth(job.startDate);
      const end = job.endDate ? formatMonth(job.endDate) : 'Present';
      const locParts = [job.location?.city, job.location?.country].filter(Boolean);
      const locStr = locParts.join(', ');

      md += `*(${start} - ${end})* ${locStr ? `*${locStr}*` : ''}\n\n`;

      if (job.summary) {
        md += `${job.summary.trim()}\n\n`;
      }

      if (Array.isArray(job.highlights) && job.highlights.length > 0) {
        for (const h of job.highlights) {
          md += `- ${h}\n`;
        }
        md += `\n`;
      }
    }
    md += `---\n\n`;
  }

  // Skills
  if (Array.isArray(data.skills) && data.skills.length > 0) {
    md += `## Skills\n`;
    for (const s of data.skills) {
      md += `- ${s}\n`;
    }
    md += `\n---\n\n`;
  }

  // Languages
  if (Array.isArray(data.languages) && data.languages.length > 0) {
    md += `## Languages\n`;
    for (const l of data.languages) {
      md += `- ${l}\n`;
    }
    md += `\n---\n\n`;
  }

  // Education
  if (Array.isArray(data.education) && data.education.length > 0) {
    md += `## Education\n`;
    for (const edu of data.education) {
      if (edu.fieldOfStudy) {
        md += `**${edu.fieldOfStudy}**  \n`;
      }
      const start = edu.startDate || '';
      const end = edu.endDate || '';
      const dates = (start && end) ? `${start}-${end}` : (start || end || '');
      md += `${edu.institution}${dates ? ` - ${dates}` : ''}  \n`;
      if (edu.location?.city) {
        md += `${edu.location.city}\n\n`;
      } else {
        md += `\n`;
      }
    }
    md += `---\n\n`;
  }

  // Volunteer Experience
  if (Array.isArray(data.volunteerExperience) && data.volunteerExperience.length > 0) {
    md += `## Volunteer Experience\n`;
    for (const vol of data.volunteerExperience) {
      md += `### ${vol.organization}\n`;
      if (vol.role) {
        md += `${vol.role}  \n`;
      }
      const start = vol.startDate || '';
      const end = vol.endDate || '';
      const dates = (start && end) ? `(${start} - ${end})` : '';
      const locParts = [vol.location?.city, vol.location?.country].filter(Boolean);
      md += `${dates ? `*${dates}* ` : ''}${locParts.length > 0 ? `*${locParts.join(', ')}*` : ''}\n\n`;

      if (Array.isArray(vol.highlights)) {
        for (const h of vol.highlights) {
          md += `- ${h}\n`;
        }
        md += `\n`;
      }
    }
  }

  return md.trim() + '\n';
}

module.exports = {
  formatMonth,
  jsonToMarkdown
};
