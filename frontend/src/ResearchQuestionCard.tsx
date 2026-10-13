import { useRef, useState } from 'react';
import { Check, CircleHelp, LoaderCircle, Send } from 'lucide-react';
import type { ChatQuestion } from './researchChatModel';

export function ResearchQuestionCard({ question, vi, onAnswer }: {
  question: ChatQuestion; vi: boolean; onAnswer: (answers: string[][], reject: boolean) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<string[][]>(() => question.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => question.questions.map(() => ''));
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const label = (a: string, b: string) => vi ? a : b;
  const editable = question.state === 'pending';
  const result = question.questions.map((item, i) => {
    const typed = custom[i].trim();
    return typed ? (item.multiple ? [...new Set([...answers[i], typed])] : [typed]) : answers[i];
  });
  const submit = async (reject: boolean) => {
    if (lock.current || !editable || (!reject && result.some(item => !item.length || item.length > 6))) return;
    lock.current = true; setSending(true);
    try { await onAnswer(reject ? [] : result, reject); }
    finally { lock.current = false; setSending(false); }
  };
  return <section className="research-chat__question" aria-label={label('Câu hỏi từ OpenCode', 'Question from OpenCode')}>
    <header><CircleHelp size={18} /><span>{editable ? label('OpenCode cần bạn làm rõ', 'OpenCode needs your input') : question.state === 'answered' ? label('Đã trả lời', 'Answered') : question.state === 'rejected' ? label('Đã bỏ qua', 'Skipped') : label('Câu hỏi đã đóng', 'Question closed')}</span>{sending && <LoaderCircle size={15} className="spin" />}</header>
    {question.questions.map((item, i) => <fieldset key={i} disabled={!editable || sending}>
      <legend>{item.question}</legend>
      {editable ? <>
        <div className="research-chat__question-options" role="group" aria-label={item.header || item.question}>
          {item.options.map(option => {
            const selected = answers[i].includes(option.label);
            return <button key={option.label} type="button" aria-pressed={selected} onClick={() => {
              setAnswers(values => values.map((value, index) => index !== i ? value : item.multiple ? selected ? value.filter(text => text !== option.label) : [...value, option.label] : [option.label]));
              if (!item.multiple) setCustom(values => values.map((value, index) => index === i ? '' : value));
            }}>{selected && <Check size={14} />}<span>{option.label}{option.description && <small>{option.description}</small>}</span></button>;
          })}
        </div>
        {item.custom && <textarea maxLength={2000} rows={2} aria-label={label('Câu trả lời riêng ', 'Your own answer ') + (i+1)} placeholder={label('Hoặc viết ý của bạn…', 'Or write your own answer…')} value={custom[i]} onChange={event => {
          setCustom(values => values.map((value, index) => index === i ? event.target.value : value));
          if (!item.multiple) setAnswers(values => values.map((value, index) => index === i ? [] : value));
        }} />}
        {item.multiple && <small>{label('Có thể chọn nhiều đáp án.', 'You can select multiple answers.')}</small>}
      </> : question.answers?.[i]?.length ? <p>{question.answers[i].join(' · ')}</p> : <p>{label('Không có câu trả lời được gửi.', 'No answer was submitted.')}</p>}
    </fieldset>)}
    {editable && <footer><span>{label('Chỉ tiếp tục khi bạn gửi câu trả lời.', 'Continues only after you submit.')}</span><button type="button" disabled={sending} onClick={() => void submit(true)}>{label('Bỏ qua', 'Skip')}</button><button type="button" className="research-chat__question-submit" disabled={sending || result.some(item => !item.length || item.length > 6)} onClick={() => void submit(false)}><Send size={14} />{label('Gửi câu trả lời', 'Submit answer')}</button></footer>}
  </section>;
}
