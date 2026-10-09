import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'state.json');
const defaults = { profile: { name: 'Learner', level: 'Undergraduate', subject: 'General', target: 'Build strong fundamentals' }, syllabus: null, mastery: {}, weaknesses: [], strengths: [], mistakes: [], activity: [], chatHistory: [], studyPlan: [], updatedAt: null };
function ensure() { fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaults, null, 2)); }
export function readState() { ensure(); try { return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { ...defaults }; } }
export function writeState(value) {
  ensure();
  const safe = { ...defaults, ...value, updatedAt: new Date().toISOString() };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return safe;
}
export function resetState() { return writeState(defaults); }
