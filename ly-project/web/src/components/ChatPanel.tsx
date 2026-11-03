import { useRef, useState } from 'react';
import { streamChat, type ChatTurn, type Passage } from '../api';
import { ContentBadge } from './Badges';
import Icon from './Icon';
import Markdown from './Markdown';

interface Message extends ChatTurn {
  passages?: Passage[];
}

/**
 * Case-scoped chat. Every answer is grounded in passages retrieved from THIS
 * judgment only, and those passages are rendered above the answer as it
 * streams — evidence first, so the user can judge the answer against what the
 * model was actually given rather than taking it on trust.
 */
export default function ChatPanel({ tid, title }: { tid: number; title: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;

    setDraft('');
    setError(null);
    setBusy(true);

    const history: ChatTurn[] = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '' }]);

    await streamChat(tid, question, history, {
      onSources: (passages) =>
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { ...next[next.length - 1], passages };
          return next;
        }),
      onToken: (text) =>
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + text };
          return next;
        }),
      onDone: () => {
        setBusy(false);
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
      },
      onError: (message) => {
        setError(message);
        setBusy(false);
        setMessages((m) => m.slice(0, -1));
      },
    });
  }

  return (
    <div className="flex flex-col">
      {messages.length === 0 && (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="flex items-start gap-2 text-sm text-stone-700">
            <Icon name="chat" size={16} className="mt-0.5 text-maroon-600" />
            <span>Ask about <span className="font-medium">{title}</span>. Answers come only from this
            judgment&rsquo;s own text, with the passages used shown alongside.
            </span>
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {[
              'What did the court actually decide?',
              'What factors did it say should guide the discretion?',
              'Which earlier cases did it disagree with?',
            ].map((q) => (
              <li key={q}>
                <button
                  onClick={() => setDraft(q)}
                  className="text-stone-600 underline decoration-gold-300 underline-offset-4
                             hover:decoration-maroon-500"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-5">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg bg-maroon-800 px-3.5 py-2 text-sm text-white">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={i}>
              {m.passages && m.passages.length > 0 && (
                <details className="mb-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-stone-600">
                    {m.passages.length} passages from this judgment were used
                  </summary>
                  <ol className="mt-3 space-y-3">
                    {m.passages.map((p, n) => (
                      <li key={p.id} className="text-[13px]">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="font-mono text-[11px] text-stone-400">[{n + 1}]</span>
                          <ContentBadge type={p.contentType} />
                          {p.locator && (
                            <span className="text-[11px] text-stone-400">{p.locator}</span>
                          )}
                        </div>
                        <p className="judgment-text text-stone-600 line-clamp-4">{p.text}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {m.content ? (
                <Markdown
                  text={m.content}
                  className="rounded-lg border border-stone-200 bg-white px-4 py-3.5 text-[15px] text-stone-800"
                />
              ) : (
                <p className="text-sm text-stone-400">Thinking&hellip;</p>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
          {error}
        </p>
      )}

      <form onSubmit={send} className="mt-5 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about this judgment…"
          disabled={busy}
          className="flex-1 rounded-md border border-stone-300 bg-white px-3.5 py-2.5 text-sm
                     outline-none focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100
                     disabled:bg-stone-50"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="flex items-center gap-2 rounded-md bg-maroon-800 px-4 py-2.5 text-sm
                     font-medium text-white transition-colors hover:bg-maroon-700 disabled:opacity-40"
        >
          <Icon name="send" size={15} />
          {busy ? 'Answering…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
