const UNIT_START = /^(?:\d+[.)]\s*)?(?:unit|module|chapter|part|block)\s*(?:(?:no\.?|number)\s*)?(?:[-–—:.)]?\s*)?(?:[ivxlcdm]+|\d+)\b(?:\s*[:.)\-–—]|\s|$)/i;
const SYLLABUS_START = /^(?:detailed\s+)?(?:course\s+)?(?:syllabus|course contents|contents of course|course outline|subject contents)\s*[:\-–—]?$/i;
const ADMIN_SECTION = /^(?:references?|text\s*books?|recommended\s+books?|suggested\s+readings?|bibliography|question\s*paper\s*pattern|exam(?:ination)?\s+(?:scheme|pattern|rules|instructions)|evaluation\s+(?:scheme|criteria)|assessment\s+(?:scheme|pattern)|grading\s+scheme|attendance\s+rules?|course outcomes?|program outcomes?|programme outcomes?|po\s*[-/]\s*co mapping|mapping of course outcomes|academic regulations?|general instructions?|important instructions?|eligibility criteria|fee structure|academic calendar|teaching scheme|distribution of marks|internal assessment|external assessment)\b/i;
const ADMIN_LINE = /(?:\bwww\.[^\s]+|https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:phone|telephone|fax)\s*[:#-]|\b(?:admission|registration)\s+(?:no\.?|number)|\broll\s+no\.?|\bdate\s+of\s+(?:issue|printing)|\bdownloaded\s+from\b|\bconfidential\b)/i;
const INSTITUTION_LINE = /^(?:[A-Z][A-Z .&'-]*(?:UNIVERSITY|COLLEGE|INSTITUTE|INSTITUTION)|(?:department|faculty|school|university|college|institute)\s+of\b)/i;
const METADATA_LINE = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$|^(?:course|subject|paper)\s*code\s*[:\-]|^(?:semester|sem\.?|year|branch|programme|program|department|faculty|school|university|institute|college|credits?|l\s*[-/]\s*t\s*[-/]\s*p|contact hours?|duration|maximum marks?|total marks?|exam duration|prerequisite)\s*[:\-]/i;

function cleanLine(line) {
  return String(line || '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ')
    .replace(/^\s*[•▪◦●■◆➢➤*]+\s*/, '').trim();
}

/** Extract actual curriculum topics, excluding cover pages and evaluation tables. */
export function extractSyllabusContent(rawText = '') {
  const normalized = String(rawText).replace(/\u0000/g, '').replace(/\r/g, '\n').replace(/[\f\v]/g, '\n');
  const lines = normalized.split('\n').map(cleanLine).filter(Boolean);
  if (!lines.length) return { text: '', removedLines: 0, detectedUnits: 0 };

  const unitIndexes = [];
  for (let i = 0; i < lines.length; i++) if (UNIT_START.test(lines[i])) unitIndexes.push(i);
  const hasUnits = unitIndexes.length > 0;
  // University syllabus PDFs often spend several pages on evaluation tables before Unit I.
  // When unit headings exist, ignore all front matter before the first real unit.
  const startIndex = hasUnits ? unitIndexes[0] : 0;
  const sourceLines = lines.slice(startIndex);
  const frequency = new Map();
  for (const line of sourceLines) {
    const key = line.toLowerCase().replace(/\s+/g, ' ');
    frequency.set(key, (frequency.get(key) || 0) + 1);
  }

  const kept = [];
  let skippingAdminSection = false;
  let removedLines = startIndex;
  let detectedUnits = 0;
  for (const line of sourceLines) {
    const isUnit = UNIT_START.test(line);
    const isSyllabusHeading = SYLLABUS_START.test(line) || /^(?:unit[- ]wise|course content|detailed contents)\b/i.test(line);
    if (isUnit) { skippingAdminSection = false; detectedUnits++; }
    if (isSyllabusHeading) { skippingAdminSection = false; kept.push('Syllabus Topics'); continue; }

    if (ADMIN_SECTION.test(line)) { skippingAdminSection = true; removedLines++; continue; }
    if (skippingAdminSection) {
      if (!isUnit && !isSyllabusHeading) { removedLines++; continue; }
      skippingAdminSection = false;
    }

    const pageFurniture = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(line)
      || /^page\s+\d+\s+of\s+\d+$/i.test(line)
      || /^(?:continued|contd\.?|confidential|for office use only)$/i.test(line)
      || /^[-_=*]{3,}$/.test(line);
    const admin = METADATA_LINE.test(line) || ADMIN_LINE.test(line) || INSTITUTION_LINE.test(line) || pageFurniture;
    const repeatedHeader = (frequency.get(line.toLowerCase().replace(/\s+/g, ' ')) || 0) >= 3 && line.length < 100 && !isUnit;
    if (admin || repeatedHeader || /^[\W_]+$/.test(line)) { removedLines++; continue; }
    if (/^(?:evaluation scheme|sessional component|end semester examination|subject code|subject name|total credit|abbreviation used)\b/i.test(line)) { removedLines++; continue; }
    kept.push(line);
  }

  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // No unit labels? Use a conservative filter so valid topic lists are not erased.
  if (!hasUnits) {
    const conservative = lines.filter(line => !/^page\s+\d+\s+of\s+\d+$/i.test(line)
      && !ADMIN_LINE.test(line) && !METADATA_LINE.test(line) && !INSTITUTION_LINE.test(line)
      && !ADMIN_SECTION.test(line) && !/^(?:evaluation scheme|abbreviation used|sessional component)\b/i.test(line));
    text = conservative.join('\n').trim();
  }
  return { text, removedLines, detectedUnits };
}
