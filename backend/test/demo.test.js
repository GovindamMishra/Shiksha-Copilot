import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAction } from '../ai/demo.js';
import { readState, writeState, resetState } from '../storage.js';

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
