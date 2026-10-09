import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAction } from '../ai/demo.js';
import { readState, writeState, resetState } from '../storage.js';
import { extractSyllabusContent } from '../syllabus-extractor.js';

test('demo adaptive quiz returns a valid objective question for linked lists', () => {
  const q=demoAction('adaptive-quiz',{}, {syllabus:{subject:'Data Structures',units:[{name:'Unit 1',topics:[{name:'Linked Lists'}]}]},mastery:{'Linked Lists':35},weaknesses:['Linked Lists']});
  assert.equal(q.topic,'Linked Lists'); assert.equal(q.options.length,4); assert.ok(q.answerIndex>=0&&q.answerIndex<4); assert.ok(q.explanation.length>10);
});

test('demo evaluation deterministically grades objective answers', () => {
  assert.equal(demoAction('evaluate',{answer:'B',expectedAnswer:'B'}).correct,true);
  assert.equal(demoAction('evaluate',{answer:'A',expectedAnswer:'B'}).correct,false);
});

test('demo tutor answers general learning questions without forcing syllabus context', () => {
  const answer=demoAction('ask',{message:'What is an operating system?'},{});
  assert.match(answer,/system software/i); assert.match(answer,/memory management/i);
});

test('persistent state survives a read after write', () => {
  const initial=readState();
  try {
    const saved=writeState({...initial,profile:{name:'Smoke Test Learner',level:'Undergraduate',subject:'Data Structures',target:'Test persistence'}});
    assert.equal(readState().profile.name,'Smoke Test Learner'); assert.ok(saved.updatedAt);
  } finally { writeState(initial); }
});

test('readiness does not invent a mastery score without evidence', () => {
  const r=demoAction('readiness',{}, {mastery:{},weaknesses:[]});
  assert.equal(r.readinessScore,null); assert.match(r.riskFactors[0],/Not enough/i);
});


test('independent verification generates an open-ended question without exposing options in the UI contract', () => {
  const result = demoAction('independent-question', {topic:'Trees', difficulty:'medium'}, {syllabus:{units:[{name:'Trees',topics:[{name:'Trees'}]}]}});
  assert.equal(typeof result.question, 'string');
  assert.match(result.question, /AVL|rotation|tree/i);
  assert.ok(Array.isArray(result.options)); // shared API schema; frontend intentionally does not render options
  assert.equal(typeof result.explanation, 'string'); // held internally until submission
});

test('independent verification evaluation is explicitly labeled as a demo heuristic', () => {
  const result = demoAction('evaluate', {independentVerification:true, question:'Explain probability', answer:'Probability is the chance of an event. Favorable outcomes divided by total outcomes gives probability.', expectedAnswer:'Probability measures likelihood; divide favorable outcomes by total equally likely outcomes.'}, {});
  assert.equal(typeof result.score, 'number');
  assert.match(result.explanation, /local demo|keyword/i);
});


test('syllabus PDF extraction keeps unit topics and removes institution and page furniture', () => {
  const raw = `ABC UNIVERSITY\nDepartment of Computer Science\nB.Tech CSE — Semester IV\nPage 1 of 3\nSubject: Data Structures and Algorithms\nCourse Code: CS401\nUNIT I: Trees\nBinary trees and tree traversals\nBinary search trees\nAVL trees and rotations\nPage 2 of 3\nABC UNIVERSITY\nUNIT II: Graphs\nGraph representations\nBFS and DFS traversal\nEvaluation Scheme\nInternal assessment: 30 marks\nEnd semester examination: 70 marks\nReferences\nData Structures by Author`;
  const result = extractSyllabusContent(raw);
  assert.doesNotMatch(result.text, /Subject: Data Structures and Algorithms/); // front matter is intentionally excluded once units are found
  assert.match(result.text, /UNIT I: Trees/);
  assert.match(result.text, /AVL trees and rotations/);
  assert.match(result.text, /UNIT II: Graphs/);
  assert.match(result.text, /BFS and DFS traversal/);
  assert.doesNotMatch(result.text, /ABC UNIVERSITY|Department of Computer Science|Course Code|Page 1 of 3|Internal assessment|References|Data Structures by Author/i);
  assert.equal(result.detectedUnits, 2);
});

test('syllabus extraction conservatively retains topic text when no unit headings exist', () => {
  const raw = `Probability\nProbability axioms and sample spaces\nConditional probability and Bayes theorem\nRandom variables and probability distributions`;
  const result = extractSyllabusContent(raw);
  assert.match(result.text, /Bayes theorem/);
  assert.match(result.text, /Random variables/);
});

test('AKTU-style first pages with evaluation tables are excluded before Unit I', () => {
  const raw = `Page 1 of 40
DR. A.P.J. ABDUL KALAM TECHNICAL UNIVERSITY, UTTAR PRADESH, LUCKNOW
EVALUATION SCHEME AND SYLLABI
For
B. Tech. 1ST Year
Effective from the Session: 2022-23
Page 2 of 40
B. Tech. First Year, Semester- I
Evaluation Scheme
SN
Subject Code
Subject Name
Sessional Component
End Semester Examination
Total Credit
BAS101 Engineering Physics
Page 3 of 40
Abbreviation Used:
BS: Basic Science Course
Page 4 of 40
UNIT – I: Differential Calculus
Successive differentiation and Leibnitz theorem
Taylor's theorem and Maclaurin's theorem
UNIT – II: Matrices
Rank of a matrix and linear systems
Eigenvalues and eigenvectors
Evaluation Scheme
Internal assessment: 30 marks
References
Recommended textbook list`;
  const result = extractSyllabusContent(raw);
  assert.match(result.text, /UNIT – I: Differential Calculus/);
  assert.match(result.text, /Taylor's theorem/);
  assert.match(result.text, /UNIT – II: Matrices/);
  assert.match(result.text, /Eigenvalues and eigenvectors/);
  assert.doesNotMatch(result.text, /Page 1 of 40|ABDUL KALAM|Evaluation Scheme|Subject Code|Sessional Component|Abbreviation Used|Recommended textbook/i);
  assert.equal(result.detectedUnits, 2);
});
