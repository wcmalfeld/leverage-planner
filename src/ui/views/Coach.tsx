import { useRef, useState } from 'react';
import { store } from '../../store/store';
import { todayISO } from '../../domain/time';
import { aiReady, aiSettings, useAISettings } from '../../ai/settings';
import { coachSession, useCoachSession } from '../../ai/session';
import { describeError, openingTurn, streamCoachReply, textOf, type ChatMessage } from '../../ai/coach';
import { Notice, toast } from '../components/common';
import { Icon } from '../components/icons';

const STARTERS = [
  'What should I focus on this week?',
  'Is my stated bottleneck the right one?',
  'Where is my time going that it shouldn’t?',
  'Look at today’s plan. What would you change?',
];

export function CoachView() {
  const ai = useAISettings();
  const ready = aiReady(ai);
  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">AI strategy coach</div>
          <h1>Talk through your strategy</h1>
          <p>Claude reads a snapshot of your goals, bottleneck, ranked tasks, routine and recent reviews, then helps you decide where your time should go. It can also power “What am I missing?” on the Tasks page.</p>
        </div>
      </header>
      {ready ? (
        <div className="plan-layout">
          <Chat apiKey={ai.apiKey} />
          <aside className="side-sticky"><Connection /></aside>
        </div>
      ) : (
        <Connection />
      )}
    </>
  );
}

function Connection() {
  const ai = useAISettings();
  const [key, setKey] = useState('');
  const [consent, setConsent] = useState(false);

  if (aiReady(ai))
    return (
      <section className="panel stack tight">
        <h2>Connection</h2>
        <p className="small muted">Connected to Claude with the key ending <span className="mono">…{ai.apiKey.slice(-4)}</span>. Usage is billed to your Anthropic account.</p>
        <p className="xs faint">Your planner snapshot is sent to Anthropic only when you ask the coach something. The key stays in this browser and is never included in backups.</p>
        <div>
          <button className="btn sm ghost danger" onClick={() => { aiSettings.clear(); coachSession.setChat([]); coachSession.setSuggestions(null); toast('Disconnected and key removed'); }}>Disconnect and forget key</button>
        </div>
      </section>
    );

  return (
    <section className="panel stack" style={{ maxWidth: '44rem' }}>
      <h2>Connect Claude</h2>
      <p className="small muted">
        This site has no server, so the coach uses your own Anthropic API key. Create one in the{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Console</a>; usage is billed to your account.
      </p>
      <label className="stack tight">
        <span className="small" style={{ fontWeight: 700 }}>API key</span>
        <input id="ai-key" className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <label className="check small">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I understand that when I ask the coach something, a snapshot of my goals, tasks, routine, logged time and review notes is sent to Anthropic.
      </label>
      <p className="xs faint">The key is stored only in this browser, separately from your planner data, and is never included in exports. Anyone with access to this browser profile could read it.</p>
      <div>
        <button className="btn primary" disabled={!key.trim() || !consent} onClick={() => { aiSettings.set({ apiKey: key.trim(), consent: true }); toast('Claude connected'); }}>
          <Icon.spark />Connect
        </button>
      </div>
    </section>
  );
}

function Chat({ apiKey }: { apiKey: string }) {
  const { chat } = useCoachSession();
  const [draft, setDraft] = useState('');
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history = coachSession.get().chat;
    const turn: ChatMessage = history.length ? { role: 'user', content: question } : openingTurn(store.get(), todayISO(), question);
    const next = [...history, turn];
    coachSession.setChat(next);
    setDraft('');
    setPartial('');
    setError(null);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const reply = await streamCoachReply(apiKey, next, (d) => setPartial((p) => p + d), abort.current.signal);
      coachSession.setChat([...next, { role: 'assistant', content: reply.content }]);
    } catch (e) {
      // Drop the unanswered question so it can be edited and resent.
      coachSession.setChat(history);
      setDraft(question);
      setError(describeError(e));
    } finally {
      setBusy(false);
      setPartial('');
      abort.current = null;
    }
  };

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h2>Coach</h2>
        {chat.length > 0 && !busy && <button className="btn sm ghost" onClick={() => { coachSession.setChat([]); setError(null); }}><Icon.refresh />New conversation</button>}
      </div>

      {chat.length === 0 && !busy ? (
        <div className="stack tight">
          <p className="small muted">Ask anything about your goals, priorities or plan, or start with one of these:</p>
          <div className="row">
            {STARTERS.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}
          </div>
        </div>
      ) : (
        <div className="chat-log" aria-live="polite">
          {chat.map((m, i) => <div key={i} className={`chat-msg ${m.role}`}>{textOf(m)}</div>)}
          {busy && <div className="chat-msg assistant">{partial || <span className="faint">Thinking…</span>}</div>}
        </div>
      )}

      {error && <Notice kind="crit">{error}</Notice>}

      <form className="stack tight" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea
          id="coach-input"
          className="input"
          rows={3}
          value={draft}
          placeholder={chat.length ? 'Follow up…' : 'Ask the coach…'}
          aria-label="Message the coach"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
        />
        <div className="row between">
          <span className="xs faint">{chat.length ? 'Uses the snapshot from the start of this conversation.' : 'Enter to send · Shift+Enter for a new line'}</span>
          {busy ? <button type="button" className="btn sm" onClick={() => abort.current?.abort()}>Stop</button> : <button className="btn primary sm" disabled={!draft.trim()}>Send</button>}
        </div>
      </form>
    </section>
  );
}
