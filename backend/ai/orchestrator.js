export function compactContext(ctx = {}) {
  const syllabus = ctx.syllabus || null;
  return {
    learner: ctx.learner || {},
    syllabus: syllabus ? {
      subject: syllabus.subject || null,
      units: (syllabus.units || []).map(u => ({ name: u.name, topics: (u.topics || []).map(t => ({ name: t.name || t, subtopics: t.subtopics || [] })) })),
      currentTopic: syllabus.currentTopic || null,
      rawText: String(syllabus.rawText || "").slice(0, 30000)
    } : null,
    currentTopic: ctx.currentTopic || null,
    mastery: ctx.mastery || {},
    weaknesses: Array.isArray(ctx.weaknesses) ? ctx.weaknesses.slice(0, 12) : [],
    strengths: Array.isArray(ctx.strengths) ? ctx.strengths.slice(0, 12) : [],
    mistakes: Array.isArray(ctx.mistakes) ? ctx.mistakes.slice(0, 12) : [],
    recentActivity: Array.isArray(ctx.recentActivity) ? ctx.recentActivity.slice(-15) : [],
    studyPlan: Array.isArray(ctx.studyPlan) ? ctx.studyPlan.slice(0, 30) : []
  };
}

const schema = (type, properties, required = []) => ({ type, properties, required });
const stringArray = { type: "array", items: { type: "string" } };

export function responseSchemaFor(action) {
  const question = {
    type: "object",
    properties: {
      question: { type: "string" }, options: { type: "array", items: { type: "string" } }, answerIndex: { type: "integer" }, explanation: { type: "string" }, topic: { type: "string" }, subtopic: { type: "string" }, difficulty: { type: "string" }, concept: { type: "string" }, cognitiveLevel: { type: "string" }
    }, required: ["question", "options", "answerIndex", "explanation", "topic", "difficulty"]
  };
  switch (action) {
    case "parse-syllabus": return schema("object", { subject: { type: "string" }, units: { type: "array", items: schema("object", { name: { type: "string" }, topics: { type: "array", items: schema("object", { name: { type: "string" }, subtopics: stringArray }, ["name"]) } }, ["name", "topics"]) } }, ["units"]);
    case "flashcards": return { type: "array", items: schema("object", { front: { type: "string" }, back: { type: "string" }, difficulty: { type: "string" }, concept: { type: "string" } }, ["front", "back", "difficulty", "concept"]) };
    case "quiz": case "adaptive-quiz": case "adaptive-next": case "independent-question": return question;
    case "evaluate": return schema("object", { correct: { type: "boolean" }, score: { type: "number" }, diagnosisType: { type: "string" }, explanation: { type: "string" }, misconception: { type: "string" }, remediation: { type: "string" }, recommendedDifficulty: { type: "string" }, nextAction: { type: "string" } }, ["correct", "score", "diagnosisType", "explanation", "remediation", "nextAction"]);
    case "study-plan": return schema("object", { days: { type: "array", items: schema("object", { day: { type: "integer" }, focus: { type: "string" }, activities: stringArray, estimatedMinutes: { type: "integer" }, successSignal: { type: "string" } }, ["day", "focus", "activities", "estimatedMinutes", "successSignal"]) } }, ["days"]);
    case "readiness": return schema("object", { readinessScore: { type: "number" }, strongestAreas: stringArray, weakestAreas: stringArray, riskFactors: stringArray, priorityTopics: stringArray, nextBestAction: { type: "string" } }, ["readinessScore", "strongestAreas", "weakestAreas", "riskFactors", "priorityTopics", "nextBestAction"]);
    case "analyze": return schema("object", { summary: { type: "string" }, strongestAreas: stringArray, weakestAreas: stringArray, confidenceGaps: stringArray, recommendedActions: stringArray, estimatedMastery: { type: "object", additionalProperties: { type: "number" } } }, ["summary", "strongestAreas", "weakestAreas", "confidenceGaps", "recommendedActions", "estimatedMastery"]);
    case "next-action": return schema("object", { action: { type: "string" }, topic: { type: "string" }, reason: { type: "string" }, difficulty: { type: "string" }, expectedOutcome: { type: "string" } }, ["action", "topic", "reason", "difficulty", "expectedOutcome"]);
    default: return null;
  }
}

export function buildPrompt(action, payload = {}, context = {}, history = []) {
  const ctx = compactContext(context);
  const historyText = history.slice(-10).map(m => `${m.role === "assistant" ? "SHIKSHA" : "LEARNER"}: ${String(m.content || "")}`).join("\n");
  const instruction = instructionFor(action, payload);
  return `SHIKSHA COPILOT CONTEXT\n${JSON.stringify(ctx, null, 2)}\n\nRECENT CHAT\n${historyText || "None"}\n\nTASK\n${instruction}`;
}

function instructionFor(action, p) {
  const topic = p.topic || p.currentTopic || "the selected learning area";
  switch (action) {
    case "parse-syllabus": return `Extract ONLY the actual subject curriculum from this text. Keep the subject/course title when present, unit/module/chapter headings, and the topics/subtopics taught. Exclude institution headers/footers, page numbers, course codes, credits, contact details, exam rules, marking schemes, attendance policies, administrative notices, course/program outcome mapping, and references/textbooks unless they are explicitly part of the taught topic list. Preserve the original unit order and topic wording. Do not invent topics. If no explicit units exist, group related syllabus topics into sensible units without adding new subject matter. Raw extracted text:\n${p.text || ""}`;
    case "ask": return `Answer this learner question: ${p.message || "Help me learn."}\nIf it is general knowledge, answer it normally even if unrelated to the syllabus. If it is syllabus-related, ground it in the relevant unit/topic(s), then personalize using the learner evidence.`;
    case "notes": return `Create detailed, exam-ready notes for ${topic}. Include: learning objectives; prerequisites; definitions; core concepts; sub-concepts; formulas/algorithms/processes where applicable; intuitive explanation; worked examples; common misconceptions; exam-focused points; practice prompts; and a concise recap. Scope the main notes to this topic but use prerequisite links from the loaded syllabus when relevant.`;
    case "syllabus-notes": return `Create comprehensive notes for the ENTIRE loaded syllabus. Cover every unit and every indexed topic in syllabus order. For each topic include explanation, key terms, formulas/processes when applicable, examples, common mistakes and exam points. Finish with cross-unit dependencies and a revision checklist. Do not collapse the syllabus into a summary.`;
    case "quick-revision": return `Create a high-density revision sheet for ${topic}: definitions, key ideas, formulas/processes, examples, common traps and exam triggers.`;
    case "flashcards": return `Create 12 high-quality flashcards for ${topic}. Mix definitions, conceptual distinctions, applications and common mistakes.`;
    case "quiz": return `Create ${p.count || 5} practice questions for ${topic} at ${p.difficulty || "adaptive"} difficulty. Mix recall, understanding, application and analysis. Return four plausible options and a clear explanation for the correct answer.`;
    case "adaptive-quiz": return `Create the FIRST question of an adaptive assessment using ONLY the loaded syllabus topics. Choose the highest-value topic from mastery, weaknesses, mistakes and recent activity. Start at an appropriate difficulty for that topic. Do not ask about anything outside the syllabus. Return exactly one high-quality MCQ with four plausible options. Include the unit/topic/subtopic and cognitive level.`;
    case "independent-question": return `Create one NEW independent-understanding verification question for the learner's selected topic: ${topic}. The learner may have studied this topic and practised with AI, so test transfer/application rather than recall of a definition. Avoid repeating these previous questions: ${JSON.stringify(p.previousQuestions || [])}. Use ONLY the loaded syllabus. Return one concise open-ended problem prompt (no multiple-choice framing, no hints, no steps, no answer, no solution in the question text). The answerIndex and options fields are required by the shared schema but will be hidden from the learner; populate them internally. Put a concise answer rubric and expected reasoning in explanation, which must not be shown until submission. Choose difficulty ${p.difficulty || "medium"}; after successful attempts, move to a harder related concept. Include the exact syllabus topic, subtopic and cognitive level.`;
    case "adaptive-next": return `Generate the NEXT question in a live adaptive assessment. The loaded syllabus is authoritative: topic MUST exactly match or clearly belong to one of its indexed topics. Never invent an off-syllabus topic. Review the previous question and learner result. If the learner was correct, normally increase difficulty or move to a closely related concept; if incorrect, reduce or stabilize difficulty and target the diagnosed gap. Prefer weak/unmastered topics, but maintain syllabus coverage and avoid repeating any previous question. Current requested difficulty: ${p.difficulty || "adaptive"}. Previous questions: ${JSON.stringify(p.previousQuestions || [])}. Last result: ${JSON.stringify(p.lastResult || null)}. Return exactly one MCQ with four plausible options and a clear explanation.`;
    case "evaluate": return `${p.independentVerification ? "This is an INDEPENDENT UNDERSTANDING VERIFICATION. Judge the learner's own written reasoning against the hidden rubric. Evaluate semantic correctness, method, application and justification; do not require exact wording. A correct answer must demonstrate the core reasoning, not merely repeat a term. Be fair to equivalent valid approaches. Return a score from 0-100 and set correct=true only when the core concept is independently applied successfully. Do not assume the learner received hints. " : "Evaluate the learner answer. "}Question: ${p.question}\nLearner answer: ${p.answer}\nExpected answer / hidden rubric: ${p.expectedAnswer || "not supplied"}\nDiagnose the exact error or misconception, give a score from 0-100, explain the reasoning and specify targeted remediation and the next action.`;
    case "study-plan": return `Create a ${p.days || 7}-day adaptive study plan using the ENTIRE syllabus, learner weaknesses and recent activity. Balance learning, active recall, practice, review and assessment. Do not schedule topics that are not in the syllabus unless explicitly marked as prerequisites.`;
    case "readiness": return `Analyze exam readiness from the available learner evidence. Distinguish measured mastery from uncertainty and identify the highest-value topics/actions.`;
    case "analyze": return `Analyze the learner model across the whole syllabus. Estimate mastery only where there is evidence; identify strengths, weak areas, confidence gaps and concrete recommended actions.`;
    case "next-action": return `Choose the single highest-value next learning action from the learner's current evidence. Prefer targeted remediation over generic advice.`;
    default: return p.message || "Help the learner.";
  }
}

export function parseJson(text) {
  if (typeof text !== "string") return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(candidate); } catch {}
  const obj = candidate.match(/\{[\s\S]*\}/)?.[0];
  const arr = candidate.match(/\[[\s\S]*\]/)?.[0];
  for (const x of [obj, arr]) { if (!x) continue; try { return JSON.parse(x); } catch {} }
  throw new Error("Gemini returned malformed JSON for a structured learning action.");
}
