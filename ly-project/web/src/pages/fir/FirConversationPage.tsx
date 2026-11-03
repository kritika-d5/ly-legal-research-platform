import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getFirCase,
  sendFirMessage,
  type ChatMessage,
  type MessageResponse,
} from '../../api/fir';
import Icon from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';

/**
 * FIR Conversation page.
 *
 * Displays the FIR conversation, sends messages, shows progress and
 * completeness. This is a COMPLETELY SEPARATE conversation from Legal Chat.
 * No Legal Chat history or state is used here.
 */
export default function FirConversationPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useDocumentTitle('FIR Conversation');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Load existing case data
  const { data: caseData, isLoading, error: loadError } = useQuery({
    queryKey: ['fir-case', caseId],
    queryFn: () => getFirCase(caseId!),
    enabled: !!caseId,
    staleTime: 10_000,
  });

  // Populate messages when case data loads
  useEffect(() => {
    if (caseData?.messages) {
      setMessages(caseData.messages);
    }
  }, [caseData]);

  // Auto-scroll to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy || !caseId) return;

    setDraft('');
    setError(null);
    setWarning(null);
    setBusy(true);

    // Optimistically add user message
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      turn: messages.length + 1,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);

    try {
      const data: MessageResponse = await sendFirMessage(caseId, text);

      // Add assistant reply
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.assistant_message,
        turn: data.case_state.turn_count,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, assistantMsg]);

      if (data.warning) {
        setWarning(data.warning);
      }

      // If the case is complete or awaiting confirmation, redirect
      if (data.next_action === 'complete') {
        navigate(`/fir/case/${caseId}/output`);
        return;
      }
      if (data.next_action === 'review_summary') {
        navigate(`/fir/case/${caseId}/review`);
        return;
      }

      // Invalidate cache to refresh progress
      queryClient.invalidateQueries({ queryKey: ['fir-case', caseId] });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send message. Please try again.');
      // Remove the optimistic user message on error
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10 text-sm text-stone-500">
        Loading conversation…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
          {(loadError as Error).message}
        </p>
        <Link to="/fir" className="mt-4 inline-block text-sm text-maroon-700 hover:underline">
          Back to FIR Assistant
        </Link>
      </div>
    );
  }

  const isComplete = caseData?.case_state.status === 'complete';
  const isAwaiting = caseData?.case_state.status === 'awaiting_confirmation';

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-400 mb-4">
        <Link to="/fir" className="hover:text-maroon-700 transition-colors">FIR Assistant</Link>
        <Icon name="chevronRight" size={12} />
        <span>Case {caseId}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-stone-900">
            FIR Conversation
          </h1>
          <p className="mt-1 text-xs text-stone-500">
            Case ID: {caseId} · Turn {caseData?.case_state.turn_count ?? 0}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAwaiting && (
            <Link
              to={`/fir/case/${caseId}/review`}
              className="inline-flex items-center gap-1.5 rounded-md bg-navy-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-600 transition-colors"
            >
              <Icon name="summary" size={13} />
              Review
            </Link>
          )}
          {isComplete && (
            <Link
              to={`/fir/case/${caseId}/output`}
              className="inline-flex items-center gap-1.5 rounded-md bg-sage-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sage-700 transition-colors"
            >
              <Icon name="document" size={13} />
              View Output
            </Link>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {caseData && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
            <span>Progress</span>
            <span>{caseData.case_state.completion_percentage}%</span>
          </div>
          <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-maroon-700 transition-all duration-500"
              style={{ width: `${caseData.case_state.completion_percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="space-y-4 mb-6">
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-maroon-800 px-3.5 py-2 text-sm text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-800">
                  {m.content}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Warning */}
      {warning && (
        <div className="mb-4 rounded-md border border-gold-200 bg-gold-50 p-3 text-xs text-gold-700">
          {warning}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
          {error}
        </div>
      )}

      {/* Input */}
      {!isComplete && (
        <form onSubmit={send} className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe what happened, or answer the question…"
            disabled={busy}
            rows={2}
            className="flex-1 rounded-md border border-stone-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100 disabled:bg-stone-50 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="self-end inline-flex items-center gap-2 rounded-md bg-maroon-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-maroon-700 disabled:opacity-40"
          >
            <Icon name="send" size={15} />
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}

      {isComplete && (
        <div className="rounded-lg border border-sage-200 bg-sage-50 p-4 text-center">
          <p className="text-sm text-sage-700 font-medium">This case has been confirmed and closed.</p>
          <Link
            to={`/fir/case/${caseId}/output`}
            className="mt-2 inline-block text-sm text-sage-700 underline underline-offset-4 hover:text-sage-600"
          >
            View the final output
          </Link>
        </div>
      )}
    </div>
  );
}
