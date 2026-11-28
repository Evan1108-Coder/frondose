import { useEffect, useRef, useState } from 'react';
import { FrondoseWordmark } from './Brand.jsx';
import { Button } from '../ui.jsx';

export const FIRST_RUN_SURVEY_KEY = 'frondose.first-run-survey.v1';
const organizationExamples = ['Linear', 'GitHub', 'OpenAI'];
const questions = [
  { id:'work', title:'Where do you do most of your work?', choices:[['solo','On my own'],['team','On a team'],['school','At school'],['other','Somewhere else']] },
  { id:'organization', title:'Where do you work?', examples:organizationExamples },
  { id:'discovery', title:'How did you hear about Frondose?', choices:[['github','GitHub'],['search','Web search'],['social','Social media'],['recommendation','A recommendation'],['other','Somewhere else']] },
  { id:'goal', title:'What brought you to Frondose?', choices:[['planning','Planning projects'],['agents','Working with AI agents'],['code','Working on code'],['exploring','Just exploring']] },
];
export function readSurvey(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(FIRST_RUN_SURVEY_KEY) || 'null'); } catch { return null; }
}
export function saveSurvey(state, storage = globalThis.localStorage) { storage.setItem(FIRST_RUN_SURVEY_KEY, JSON.stringify(state)); }

export function FirstRunSurvey({ onDone }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState(false);
  const heading = useRef(null);
  const question = questions[index], last = index === questions.length - 1;
  const answer = answers[question.id] ?? '';
  useEffect(() => heading.current?.focus(), [index]);
  function choose(value) {
    setError(false);
    setAnswers(previous => ({ ...previous, [question.id]:value }));
  }
  function finish(skipped = false) {
    try {
      const completedAnswers = Object.fromEntries(Object.entries(answers).flatMap(([key, value]) => value.trim() ? [[key, value.trim()]] : []));
      saveSurvey({ state: skipped ? 'skipped' : 'complete', ...(skipped ? {} : { answers:completedAnswers, completedAt: new Date().toISOString() }) });
    } catch {
      if (!skipped) { setError(true); return; }
    }
    onDone();
  }
  return <main className="first-run-survey" aria-labelledby="survey-question">
    <header><FrondoseWordmark width="max-content"/><progress aria-label="Questionnaire progress" value={index + 1} max={questions.length}/></header>
    <section>
      <p className="survey-eyebrow">A little about you · {index + 1} / {questions.length}</p>
      <h1 id="survey-question" tabIndex={-1} ref={heading}>{question.title}</h1>
      <p>Optional. Answers stay on this computer.</p>
      {question.examples ? <div className="survey-organization">
        <label htmlFor="survey-organization">Company or organization</label>
        <input id="survey-organization" type="text" autoComplete="organization" data-field-defaults-exclude="true" maxLength={120} placeholder="Type a name or leave blank" value={answer} onChange={event => choose(event.target.value)} />
        <div className="survey-examples" role="group" aria-label="Example organizations">{question.examples.map(name =>
          <Button key={name} aria-pressed={answer === name} onClick={() => choose(name)}>{name}</Button>)}</div>
      </div> : <div className="survey-choices" role="group" aria-labelledby="survey-question">{question.choices.map(([id, label]) =>
        <button key={id} type="button" aria-pressed={answer === id} onClick={() => choose(id)}>{label}</button>
      )}</div>}
      {error ? <p role="alert">Couldn’t save your answers. You can skip to continue setup.</p> : null}
      <footer>
        {index ? <Button onClick={() => { setError(false); setIndex(index - 1); }}>Back</Button> : null}
        <Button variant="ghost" onClick={() => finish(true)}>Skip questionnaire</Button>
        <Button variant="primary" onClick={() => last ? finish() : setIndex(index + 1)}>{last ? 'Continue to CLI setup' : 'Continue'}</Button>
      </footer>
    </section>
  </main>;
}
