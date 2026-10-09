import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, responseSchemaFor, parseJson, compactContext } from "./ai/orchestrator.js";
import { readState, writeState, resetState } from "./storage.js";
import { demoAction } from "./ai/demo.js";
import { extractSyllabusContent } from "./syllabus-extractor.js";

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(__dirname, ".env"));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite").split(",").map(s => s.trim()).filter(Boolean);
const RETRIES = Math.max(1, Number(process.env.GEMINI_RETRIES || 2));
let availableModels = null;
let availableModelsAt = 0;
const RAW_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const API_KEY = /^(?:PASTE_|YOUR_|your_api_key_here|replace_me)/i.test(RAW_API_KEY.trim()) ? "" : RAW_API_KEY.trim();
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 4096);
const TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE || 0.55);
const ai = Boolean(API_KEY);
const DEMO_FALLBACK = String(process.env.DEMO_FALLBACK || "true").toLowerCase() !== "false";

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 8_000_000) reject(new Error("Request too large. Keep the syllabus and learner context concise."));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Request body is not valid JSON.")); }
    });
    req.on("error", reject);
  });
}

function cleanSyllabus(raw = "") {
  const text = String(raw).replace(/\r/g, "").trim();
  if (!text) return { subject: null, units: [], rawText: "" };
  const lines = text.split(/\n/).map(x => x.trim()).filter(Boolean);
  const subject = (text.match(/(?:subject|course|paper|title|course\s*title)\s*[:\-]\s*([^\n]+)/i)?.[1] || "").trim() || null;
  const units = [];
  let current = null;
  const unitPattern = /^(?:unit|module|chapter|part|section|block)\s*([ivxlcdm]+|\d+)?\s*[:\-.)]?\s*(.*)$/i;
  const topicPattern = /^(?:topic|topics|contents|syllabus)\s*[:\-]\s*(.*)$/i;
  for (const source of lines) {
    const line = source.replace(/^[•*▪◦●]\s*/, "").trim();
    if (/^(?:subject|course|paper|title|course\s*title)\s*[:\-]/i.test(line)) continue;
    const um = line.match(unitPattern);
    if (um && (um[2] || um[1])) {
      const label = [um[1] ? `Unit ${um[1]}` : "Unit", um[2]].filter(Boolean).join(": ");
      current = { name: label, topics: [] };
      units.push(current);
      continue;
    }
    const tm = line.match(topicPattern);
    const clean = (tm ? tm[1] : line).replace(/^[-–—]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (!clean || /^\d+$/.test(clean)) continue;
    if (!current) {
      current = { name: subject || "General", topics: [] };
      units.push(current);
    }
    if (/^(?:unit|module|chapter|part|section|block)\b/i.test(clean)) continue;
    if (!current.topics.some(t => t.name.toLowerCase() === clean.toLowerCase())) current.topics.push({ name: clean, subtopics: [] });
  }
  return { subject, units: units.map(u => ({ name: u.name, topics: u.topics.slice(0, 120) })), rawText: text };
}

function mergeSyllabus(baseline, aiResult) {
  if (!aiResult || !Array.isArray(aiResult.units)) return baseline;
  const result = { subject: aiResult.subject || baseline.subject, units: [], rawText: baseline.rawText };
  const aiUnits = aiResult.units.filter(u => u && u.name);
  if (!aiUnits.length) return baseline;
  for (const unit of aiUnits) {
    const topics = Array.isArray(unit.topics) ? unit.topics : [];
    result.units.push({ name: String(unit.name), topics: topics.filter(t => t && t.name).map(t => ({ name: String(t.name), subtopics: Array.isArray(t.subtopics) ? t.subtopics.map(String).slice(0, 30) : [] })) });
  }
  const baselineNames = baseline.units.flatMap(u => u.topics.map(t => t.name.toLowerCase()));
  const aiNames = result.units.flatMap(u => u.topics.map(t => t.name.toLowerCase()));
  const missing = baseline.units.flatMap(u => u.topics.filter(t => !aiNames.includes(t.name.toLowerCase())).map(t => ({ unit: u.name, topic: t })));
  if (result.units.length === 0 || missing.length > Math.max(5, baselineNames.length * 0.35)) return baseline;
  for (const m of missing) {
    const target = result.units.find(u => u.name.toLowerCase() === m.unit.toLowerCase()) || result.units[0];
    if (!target.topics.some(t => t.name.toLowerCase() === m.topic.name.toLowerCase())) target.topics.push(m.topic);
  }
  return result;
}

async function listAvailableModels(force = false) {
  if (!ai) return [];
  if (!force && availableModels && Date.now() - availableModelsAt < 5 * 60_000) return availableModels;
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": API_KEY } });
  const raw = await r.text();
  if (!r.ok) throw new Error(`Gemini model discovery failed (${r.status}): ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  availableModels = (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => String(m.name || "").replace(/^models\//, ""));
  availableModelsAt = Date.now();
  return availableModels;
}

function modelCandidates(models) {
  const preferred = [MODEL, ...FALLBACK_MODELS];
  if (!models?.length) return preferred;
  return preferred.filter(m => models.includes(m));
}

function isTransient(status) { return [429, 500, 502, 503, 504].includes(status); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateWithModel(model, body) {
  let last = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY }, body: JSON.stringify(body) });
      const raw = await response.text();
      if (response.ok) return { raw, model };
      let detail = raw.slice(0, 1000);
      try { detail = JSON.parse(raw)?.error?.message || detail; } catch {}
      last = new Error(`Gemini API ${response.status}: ${detail}`);
      if (!isTransient(response.status) || (response.status === 429 && /quota|resource exhausted|billing|limit: 0/i.test(detail))) throw last;
      if (attempt < RETRIES - 1) await sleep((700 * (2 ** attempt)) + Math.floor(Math.random() * 350));
    } catch (err) {
      last = err;
      if (attempt >= RETRIES - 1) break;
      await sleep((700 * (2 ** attempt)) + Math.floor(Math.random() * 350));
    }
  }
  throw last || new Error(`Gemini model ${model} failed.`);
}

async function callGemini(action, payload, context, history) {
  if (!ai) throw new Error("GEMINI_API_KEY is missing. Add it to backend/.env and restart the server.");
  const prompt = buildPrompt(action, payload, context, history);
  const schema = responseSchemaFor(action);
  const body = {
    system_instruction: { parts: [{ text: `You are Shiksha Copilot, an adaptive AI learning system.\n\n${SYSTEM_RULES}` }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: TEMPERATURE, maxOutputTokens: MAX_OUTPUT_TOKENS }
  };
  if (schema) { body.generationConfig.responseMimeType = "application/json"; body.generationConfig.responseSchema = schema; }
  let models = [];
  try { models = modelCandidates(await listAvailableModels()); } catch (err) { console.warn(err.message); models = [MODEL, ...FALLBACK_MODELS]; }
  if (!models.length) models = [MODEL];
  let lastError = null;
  for (const model of models) {
    try {
      const result = await generateWithModel(model, body);
      let data; try { data = JSON.parse(result.raw); } catch { throw new Error("Gemini returned invalid JSON."); }
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      if (!text.trim()) { const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "unknown"; throw new Error(`Gemini returned no text (reason: ${reason}).`); }
      return schema ? parseJson(text) : text.trim();
    } catch (err) {
      lastError = err;
      console.warn(`Gemini model ${model} failed: ${err.message}`);
    }
  }
  throw new Error(`Gemini is temporarily unavailable after retrying available models. ${lastError?.message || "Try again in a moment."}`);
}

const SYSTEM_RULES = `
1. Answer the actual user question. Do not force a general question into the syllabus.
2. When the question is syllabus-related, use the ENTIRE loaded syllabus as curriculum context and identify the relevant unit/topic(s).
3. Personalize using only supplied learner evidence: level, target, mastery, strengths, weaknesses, mistakes and recent activity. Never invent learner facts.
4. For general questions, provide a complete standalone answer first, then optionally connect it to the syllabus if useful.
5. Teach for understanding: direct answer, reasoning, examples, common mistakes and next practice when appropriate.
6. For notes, cover the requested scope completely and make them exam-ready, structured and readable.
7. For practice, generate varied questions across recall, understanding, application and analysis, with explanations.
8. For assessment evaluation, diagnose the misconception or missing step, not just correct/incorrect.
9. Prefer precise terminology and preserve syllabus wording.
10. Return JSON only when the caller requests a structured JSON action.
11. For normal conversational answers, use polished, natural prose with readable Markdown: concise opening, descriptive headings only when useful, and clean bullet or numbered lists for multiple items.
12. Never expose drafting labels such as “Question”, “Answer”, “Response”, internal notes, raw separators (***, ---), or unnecessary Markdown decoration. Do not wrap ordinary answers in a template unless the task needs one.
13. For a greeting or broad opening, respond warmly and briefly. Offer at most three relevant ways to start, without a long generic feature list or repeated closing question.
14. Write Markdown normally: use ### headings, **bold**, standard numbered lists and plain hyphen bullets. Never add backslashes before Markdown punctuation, never HTML-encode spaces or punctuation (such as &amp;#x20;), and never return raw markup artifacts.
15. For formulas, use readable LaTeX only when needed; do not escape percent signs or Markdown characters. Keep explanations polished and easy to scan.`;

async function handleAI(body) {
  const action = body.action || "ask";
  const payload = body.payload || {};
  const context = compactContext(body.context || {});
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  return await callGemini(action, payload, context, history);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(res, 404, { ok: false, error: "Not found" });
  const ext = path.extname(file);
  const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/plain" };
  res.writeHead(200, { "Content-Type": `${types[ext] || "application/octet-stream"}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }); return res.end(); }
  try {
    if (req.url === "/api/health" && req.method === "GET") {
      let models = [];
      if (ai) { try { models = await listAvailableModels(); } catch {} }
      return sendJson(res, 200, { ok: true, provider: ai ? "gemini" : "demo", configured: Boolean(ai), activeMode: ai ? "live-ai" : "demo", demoFallback: DEMO_FALLBACK, model: MODEL, availableModels: models, fallbackModels: FALLBACK_MODELS, apiKeyConfigured: Boolean(API_KEY) });
    }
    if (req.url === "/api/syllabus/import" && req.method === "POST") {
      const body = await readBody(req);
      const filename = String(body.filename || "").slice(0, 180);
      const ext = path.extname(filename).toLowerCase();
      if (!['.txt','.pdf','.docx'].includes(ext)) return sendJson(res,415,{ok:false,error:"Supported syllabus formats are PDF, DOCX and TXT."});
      if (typeof body.contentBase64 !== 'string' || body.contentBase64.length > 7_000_000) return sendJson(res,413,{ok:false,error:"File is missing or exceeds the 5 MB limit."});
      let text = "";
      try {
        const buffer = Buffer.from(body.contentBase64, 'base64');
        if (ext === '.txt') text = buffer.toString('utf8');
        else if (ext === '.pdf') { const mod = await import('pdf-parse'); const parse = mod.default || mod; const parsed = await parse(buffer); text = parsed.text || ''; }
        else { const mammoth = await import('mammoth'); const parsed = await mammoth.extractRawText({buffer}); text = parsed.value || ''; }
      } catch (err) { return sendJson(res,422,{ok:false,error:`Could not read ${ext.toUpperCase()} file. Ensure backend dependencies are installed and the file is valid.`}); }
      text = String(text).replace(/\u0000/g,'').trim();
      if (text.length < 10) return sendJson(res,422,{ok:false,error:"No usable text was extracted. Scanned PDFs need OCR before import."});
      const extracted = extractSyllabusContent(text);
      if (extracted.text.length < 10) return sendJson(res,422,{ok:false,error:"Text was extracted, but no clear syllabus topics were detected. This may be a scanned PDF or an unusual layout. Try a text-based PDF or paste the syllabus section manually."});
      text = extracted.text;
      return sendJson(res,200,{ok:true,filename,text,characters:text.length,removedLines:extracted.removedLines,detectedUnits:extracted.detectedUnits,notice:"Filtered for syllabus topics. Review the extracted curriculum before parsing; some unusual PDF layouts may still need manual correction."});
    }
    if (req.url === "/api/syllabus/parse" && req.method === "POST") {
      const body = await readBody(req);
      const baseline = cleanSyllabus(body.text || "");
      if (!baseline.rawText) return sendJson(res, 400, { ok: false, error: "Paste your syllabus first." });
      try {
        const aiParsed = await callGemini("parse-syllabus", { text: baseline.rawText }, {}, []);
        const syllabus = mergeSyllabus(baseline, aiParsed);
        return sendJson(res, 200, { ok: true, syllabus });
      } catch (err) {
        console.warn("Gemini syllabus parsing failed; preserving deterministic syllabus parser:", err.message);
        return sendJson(res, 200, { ok: true, syllabus: baseline, warning: err.message, provider: "deterministic-fallback" });
      }
    }
    if (req.url === "/api/state" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, state: readState() });
    }
    if (req.url === "/api/state" && req.method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, 400, { ok:false, error:"State must be a JSON object." });
      const state = writeState(body);
      return sendJson(res, 200, { ok:true, state, persisted:true });
    }
    if (req.url === "/api/state/reset" && req.method === "POST") {
      return sendJson(res, 200, { ok:true, state:resetState(), reset:true });
    }
    if (req.url === "/api/syllabus" && req.method === "GET") return sendJson(res, 200, {ok:true, syllabus:readState().syllabus});
    if (req.url === "/api/syllabus" && (req.method === "POST" || req.method === "PATCH")) {
      const body = await readBody(req); const current = readState();
      if (!body.syllabus || !Array.isArray(body.syllabus.units)) return sendJson(res,400,{ok:false,error:"A structured syllabus with units is required."});
      return sendJson(res,200,{ok:true,state:writeState({...current,syllabus:body.syllabus})});
    }
    if (req.url === "/api/progress" && req.method === "GET") {
      const st=readState(); return sendJson(res,200,{ok:true,profile:st.profile,syllabus:st.syllabus,mastery:st.mastery,weaknesses:st.weaknesses,strengths:st.strengths,mistakes:st.mistakes,activity:st.activity,studyPlan:st.studyPlan,updatedAt:st.updatedAt});
    }
    if (req.url === "/api/progress/topics" && req.method === "GET") {
      const st=readState(); const topics=(st.syllabus?.units||[]).flatMap(u=>(u.topics||[]).map(t=>{const name=t.name||t;return {topic:name,mastery:st.mastery?.[name]??null,status:t.status||'not-started',assessed:st.mastery?.[name]!==undefined};}));
      return sendJson(res,200,{ok:true,topics});
    }
    if (req.url === "/api/preparation/summary" && req.method === "GET") {
      const st=readState(); const topics=(st.syllabus?.units||[]).flatMap(u=>u.topics||[]); const assessed=topics.filter(t=>st.mastery?.[t.name||t]!==undefined).length;
      return sendJson(res,200,{ok:true,subject:st.syllabus?.subject||st.profile?.subject||null,totalTopics:topics.length,assessedTopics:assessed,completedTopics:topics.filter(t=>t.status==='completed'||t.completed).length,activityCount:(st.activity||[]).length,weakestTopic:st.weaknesses?.[0]||null,mastery:st.mastery||{},updatedAt:st.updatedAt});
    }
    if (req.url === "/api/tutor/context" && req.method === "GET") {
      const st=readState(); return sendJson(res,200,{ok:true,context:compactContext({learner:st.profile,syllabus:st.syllabus,mastery:st.mastery,weaknesses:st.weaknesses,strengths:st.strengths,mistakes:st.mistakes,recentActivity:st.activity})});
    }
    if (req.url === "/api/recommendations" && req.method === "GET") {
      const st=readState(); const topics=(st.syllabus?.units||[]).flatMap(u=>(u.topics||[]).map(t=>t.name||t));
      const weak=st.weaknesses?.[0]||topics.filter(t=>st.mastery?.[t]!==undefined).sort((a,b)=>Number(st.mastery[a])-Number(st.mastery[b]))[0];
      const topic=weak||topics.find(t=>st.mastery?.[t]===undefined)||topics[0]||null;
      return sendJson(res,200,{ok:true,recommendations:topic?[{topic,title:`Review ${topic}`,difficulty:Number(st.mastery?.[topic]||0)<40?'foundational':'adaptive',reason:st.mastery?.[topic]!==undefined?`Current estimated mastery: ${st.mastery[topic]}%.`:'This topic has not been assessed yet.',status:'recommended'}]:[],evidenceBased:true});
    }
    if (req.url === "/api/recommendations/complete" && req.method === "POST") {
      const body=await readBody(req); if(!body.topic)return sendJson(res,400,{ok:false,error:"topic is required."});const st=readState();const activity=[...(st.activity||[]),{type:'recommendation-completed',topic:String(body.topic).slice(0,160),at:new Date().toISOString()}];return sendJson(res,200,{ok:true,state:writeState({...st,activity})});
    }
    if (req.url === "/api/revision/submit" && req.method === "POST") {
      const body=await readBody(req);const st=readState();const index=Number(body.index);if(!Number.isInteger(index)||index<0||index>=(st.mistakes||[]).length)return sendJson(res,400,{ok:false,error:"A valid mistake index is required."});const mistakes=[...st.mistakes];mistakes[index]={...mistakes[index],revisedAt:new Date().toISOString(),revisionResult:body.correct===true?'correct':'needs-more-practice'};return sendJson(res,200,{ok:true,state:writeState({...st,mistakes})});
    }
    if (req.url === "/api/study-plan" && req.method === "GET") return sendJson(res,200,{ok:true,studyPlan:readState().studyPlan||[]});
    if (req.url === "/api/study-plan" && (req.method === "POST" || req.method === "PATCH")) {
      const body=await readBody(req); if(!Array.isArray(body.studyPlan)) return sendJson(res,400,{ok:false,error:"studyPlan must be an array."}); const st=readState(); return sendJson(res,200,{ok:true,state:writeState({...st,studyPlan:body.studyPlan.slice(0,100)})});
    }
    if (req.url === "/api/revision/due" && req.method === "GET") {
      const st=readState(); const due=(st.mistakes||[]).filter(m=>!m.revisedAt).slice(0,50); return sendJson(res,200,{ok:true,due});
    }
    if (req.url === "/api/assessments/history" && req.method === "GET") {
      const st=readState(); return sendJson(res,200,{ok:true,history:(st.activity||[]).filter(a=>a.type==='assessment')});
    }
    if (req.url === "/api/ai" && req.method === "POST") {
      const body = await readBody(req);
      if (JSON.stringify(body).length > 1_000_000) return sendJson(res,413,{ok:false,error:"AI request is too large. Reduce the syllabus/context size."});
      if (!ai) return sendJson(res,200,{ok:true,result:demoAction(body.action||"ask",body.payload||{},compactContext(body.context||{})),provider:"demo",mode:"demo",notice:"Local deterministic demo response; no live AI request was made."});
      try {
        const result = await handleAI(body);
        return sendJson(res, 200, { ok: true, result, provider: "gemini", mode:"live-ai", model: MODEL });
      } catch (err) {
        if (!DEMO_FALLBACK) throw err;
        console.warn(`Live AI unavailable; using labeled demo fallback: ${err.message}`);
        return sendJson(res,200,{ok:true,result:demoAction(body.action||"ask",body.payload||{},compactContext(body.context||{})),provider:"demo-fallback",mode:"demo-fallback",notice:`Live AI unavailable: ${String(err.message).slice(0,220)}. This response is a local rule-based fallback, not live AI.`});
      }
    }
    if (req.method === "GET") return serveStatic(req, res);
    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
});

server.listen(PORT, () => console.log(`Shiksha Copilot Gemini server: http://localhost:${PORT}`));
