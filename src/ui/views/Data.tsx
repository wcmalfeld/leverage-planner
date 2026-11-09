import { useState } from 'react';
import { store, useApp } from '../../store/store';
import { ConfirmButton, Notice, toast } from '../components/common';
import { Icon } from '../components/icons';
import { useUI } from '../App';

export function DataView({ onRestartOnboarding }: { onRestartOnboarding: () => void }) {
  const data = useApp();
  const { freshStart } = useUI();
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const size = new Blob([JSON.stringify(data)]).size;

  const download = () => {
    const text = store.exportJSON();
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `leverage-planner-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch { /* some sandboxes block downloads; the copy box below always works */ }
    setJson(text);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json ?? store.exportJSON());
      toast('Backup copied to clipboard');
    } catch {
      setJson(json ?? store.exportJSON());
      toast('Select the text below and copy it');
    }
  };

  const importText = (text: string) => {
    try {
      store.importJSON(text);
      setError(null);
      toast('Backup restored');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Data & privacy</div>
          <h1>Your data stays here</h1>
          <p>Everything is stored locally in this browser. There are no accounts or analytics. Nothing is sent anywhere unless you connect the AI coach, and then only when you ask it something. Export a backup before clearing browser data or switching devices.</p>
        </div>
      </header>

      <div className="grid2">
        <section className="panel stack">
          <h2>Backup</h2>
          <p className="small muted">Stored in: {store.adapter.name} · {(size / 1024).toFixed(1)} KB · {data.goals.length} goals, {data.tasks.length} tasks, {Object.keys(data.plans).length} plans, {Object.keys(data.dailyReviews).length} reviews.</p>
          <div className="row">
            <button className="btn primary" onClick={download}><Icon.download />Export JSON</button>
            <button className="btn" onClick={copy}>Copy backup to clipboard</button>
          </div>
          {json && <textarea id="export-box" className="input mono xs" readOnly rows={8} value={json} onFocus={(e) => e.target.select()} aria-label="Backup JSON" />}
        </section>

        <section className="panel stack">
          <h2>Restore</h2>
          <p className="small muted">Replaces everything here with the backup. Export first if you want to keep the current data.</p>
          <label className="btn" style={{ alignSelf: 'flex-start' }}>
            <Icon.upload />Choose a backup file
            <input type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) importText(await f.text()); e.target.value = ''; }} />
          </label>
          <details>
            <summary className="small" style={{ color: 'var(--accent)', fontWeight: 700 }}>Or paste backup JSON ▾</summary>
            <PasteImport onImport={importText} />
          </details>
          {error && <Notice kind="crit">{error}</Notice>}
        </section>
      </div>

      <section className="panel stack">
        <h2>Start over</h2>
        <p className="small muted"><strong>Fresh start</strong> clears your task list or goals but keeps your routine, settings and history. <strong>Reset everything</strong> erases all of it.</p>
        <div className="row">
          <button className="btn primary" onClick={() => freshStart()}><Icon.refresh />Fresh start…</button>
          <ConfirmButton className="btn" label="Load demo data" confirm="Replace my data with the demo" onConfirm={() => { store.loadDemo(); toast('Demo loaded'); }} />
          <ConfirmButton className="btn" label="Reset everything" confirm="Erase all data" onConfirm={() => { store.reset(); onRestartOnboarding(); }} />
          <button className="btn ghost" onClick={onRestartOnboarding}>Run setup again</button>
        </div>
      </section>

      <section className="panel stack tight">
        <h2>Integration points</h2>
        <p className="small muted">The planner is built so these can be added without rewriting it:</p>
        <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
          <li><strong>AI strategy coach</strong> — Claude implements the <span className="mono">StrategyAdvisor</span> interface beside the built-in rules. Off until you connect it on the Coach page with your own API key; the key is never included in backups.</li>
          <li><strong>Calendar import</strong> — maps events to commitments (fixed) and current-plan blocks (what you expect to do).</li>
          <li><strong>Sync or other storage</strong> — swap the <span className="mono">StorageAdapter</span>; the rest of the app doesn’t change.</li>
        </ul>
      </section>
    </>
  );
}

function PasteImport({ onImport }: { onImport: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="stack tight" style={{ marginTop: '.5rem' }}>
      <textarea id="paste-import" className="input mono xs" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"version":1,…}' aria-label="Backup JSON to import" />
      <div><ConfirmButton className="btn sm" label="Restore from pasted text" confirm="Replace my data" onConfirm={() => onImport(text)} /></div>
    </div>
  );
}
