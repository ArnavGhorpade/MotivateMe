import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Clipboard,
  ClipboardCheck,
  Loader2,
  Sparkles,
  Wand2,
  X
} from 'lucide-react';
import {
  buildPlannerPrompt,
  validateImport,
  VALID_NUDGE_TONES,
  VALID_QUOTE_MODES,
  MAX_IMPORT_TASKS,
  DEFAULT_NUDGE_TONE,
  DEFAULT_QUOTE_MODE
} from './projectPlannerImport.js';

const TASK_LENGTH_OPTIONS = [
  { value: '15 minutes', label: '~15 minutes' },
  { value: '30 minutes', label: '~30 minutes' },
  { value: '1 hour', label: '~1 hour' },
  { value: '2 hours', label: '~2 hours' }
];

const TONE_LABELS = {
  supportive: 'Supportive',
  direct: 'Direct',
  tough: 'Tough'
};

const QUOTE_LABELS = {
  motivation: 'Motivation',
  wisdom: 'Wisdom',
  random: 'Random',
  custom: 'Custom message'
};

function formatPreviewDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function ProjectPlannerImport({ onCancel, onImport, importing }) {
  const [step, setStep] = useState('prompt');
  const [form, setForm] = useState({
    projectName: '',
    projectDeadline: '',
    workWindows: '',
    taskLength: TASK_LENGTH_OPTIONS[1].value,
    defaultTone: DEFAULT_NUDGE_TONE,
    defaultQuoteMode: DEFAULT_QUOTE_MODE
  });
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [previewTasks, setPreviewTasks] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleGeneratePrompt() {
    const prompt = buildPlannerPrompt(form);
    setGeneratedPrompt(prompt);
    setCopied(false);
  }

  async function handleCopy() {
    if (!generatedPrompt) return;
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can be blocked in some contexts; the textarea remains
      // selectable so the user can fall back to manual copy.
    }
  }

  function handleGoToPasteStep() {
    if (!generatedPrompt) handleGeneratePrompt();
    setStep('paste');
  }

  function handlePreview() {
    setErrorMessage('');
    const result = validateImport(pasted);
    if (!result.ok) {
      setPreviewTasks(null);
      setErrorMessage(result.error);
      return;
    }
    setPreviewTasks(result.tasks);
  }

  async function handleCreateAll() {
    if (!previewTasks || previewTasks.length === 0) return;
    try {
      await onImport(previewTasks);
    } catch (err) {
      setErrorMessage(err.message || 'Could not import tasks.');
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-5 shadow-glow">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-slate-950">
              <Sparkles size={19} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Project Planner Import</h2>
              <p className="text-sm text-slate-400">
                Paste a project into ChatGPT or Claude and import the tasks back.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            type="button"
            className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Close planner"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-wide">
          <StepPill active={step === 'prompt'} number={1} label="Generate prompt" />
          <span className="text-slate-600">·</span>
          <StepPill active={step === 'paste'} number={2} label="Paste AI output" />
        </div>

        {step === 'prompt' ? (
          <PromptStep
            form={form}
            update={update}
            generatedPrompt={generatedPrompt}
            onGenerate={handleGeneratePrompt}
            onCopy={handleCopy}
            copied={copied}
            onNext={handleGoToPasteStep}
          />
        ) : (
          <PasteStep
            pasted={pasted}
            setPasted={setPasted}
            previewTasks={previewTasks}
            errorMessage={errorMessage}
            onPreview={handlePreview}
            onCreateAll={handleCreateAll}
            onBack={() => setStep('prompt')}
            importing={importing}
          />
        )}
      </div>
    </div>
  );
}

function StepPill({ active, number, label }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${
        active
          ? 'border-blue-300/60 bg-blue-400/20 text-white'
          : 'border-white/10 bg-white/[0.04] text-slate-400'
      }`}
    >
      <span className="grid h-5 w-5 place-items-center rounded-full bg-white/[0.08] text-[10px] font-semibold">
        {number}
      </span>
      {label}
    </span>
  );
}

function PromptStep({ form, update, generatedPrompt, onGenerate, onCopy, copied, onNext }) {
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="planner-project-name">
            Project name
          </label>
          <input
            id="planner-project-name"
            value={form.projectName}
            onChange={(event) => update('projectName', event.target.value)}
            placeholder="Senior thesis"
            className="field-input"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="planner-deadline">
            Project deadline
          </label>
          <input
            id="planner-deadline"
            type="datetime-local"
            value={form.projectDeadline}
            onChange={(event) => update('projectDeadline', event.target.value)}
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="planner-task-length">
            Preferred task length
          </label>
          <select
            id="planner-task-length"
            value={form.taskLength}
            onChange={(event) => update('taskLength', event.target.value)}
            className="field-input"
          >
            {TASK_LENGTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="planner-work-windows">
            Available work windows
          </label>
          <textarea
            id="planner-work-windows"
            rows="3"
            value={form.workWindows}
            onChange={(event) => update('workWindows', event.target.value)}
            placeholder="Weeknights 7–10pm, weekend mornings 9am–noon"
            className="field-input resize-none"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="planner-default-tone">
            Default nudge tone
          </label>
          <select
            id="planner-default-tone"
            value={form.defaultTone}
            onChange={(event) => update('defaultTone', event.target.value)}
            className="field-input"
          >
            {VALID_NUDGE_TONES.map((value) => (
              <option key={value} value={value}>
                {TONE_LABELS[value] || value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="planner-default-quote">
            Default quote style
          </label>
          <select
            id="planner-default-quote"
            value={form.defaultQuoteMode}
            onChange={(event) => update('defaultQuoteMode', event.target.value)}
            className="field-input"
          >
            {VALID_QUOTE_MODES.filter((mode) => mode !== 'custom').map((mode) => (
              <option key={mode} value={mode}>
                {QUOTE_LABELS[mode] || mode}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-slate-950 transition hover:bg-blue-50"
        >
          <Wand2 size={16} />
          Generate prompt
        </button>
        <button
          type="button"
          onClick={onCopy}
          disabled={!generatedPrompt}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copied ? <ClipboardCheck size={16} /> : <Clipboard size={16} />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="ml-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:from-blue-400 hover:to-purple-400"
        >
          Next: paste AI output
        </button>
      </div>

      {generatedPrompt && (
        <div className="mt-4">
          <label className="field-label" htmlFor="planner-generated-prompt">
            Prompt to paste into ChatGPT or Claude
          </label>
          <textarea
            id="planner-generated-prompt"
            readOnly
            rows="10"
            value={generatedPrompt}
            className="field-input resize-none font-mono text-xs leading-relaxed"
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="mt-2 text-xs text-slate-500">
            Paste this prompt into ChatGPT or Claude. Ask the AI for the JSON response,
            then bring the JSON back here on step 2.
          </p>
        </div>
      )}
    </div>
  );
}

function PasteStep({
  pasted,
  setPasted,
  previewTasks,
  errorMessage,
  onPreview,
  onCreateAll,
  onBack,
  importing
}) {
  const taskCount = previewTasks?.length || 0;
  const summary = useMemo(() => {
    if (!previewTasks) return null;
    return (
      <p className="mb-3 text-sm text-slate-300">
        {taskCount} task{taskCount === 1 ? '' : 's'} ready to import. Maximum {MAX_IMPORT_TASKS}.
      </p>
    );
  }, [previewTasks, taskCount]);

  return (
    <div>
      <label className="field-label" htmlFor="planner-paste">
        Paste the AI&apos;s JSON output
      </label>
      <textarea
        id="planner-paste"
        rows="8"
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
        placeholder='[ { "title": "...", "reminderAt": "2026-06-01T15:00:00", ... } ]'
        className="field-input resize-none font-mono text-xs leading-relaxed"
        autoComplete="off"
        spellCheck={false}
      />

      {errorMessage && (
        <div className="mt-3 whitespace-pre-line rounded-lg border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
          {errorMessage}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/15"
        >
          Preview tasks
        </button>
        <button
          type="button"
          onClick={onCreateAll}
          disabled={!previewTasks || previewTasks.length === 0 || importing}
          className="ml-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:from-blue-400 hover:to-purple-400 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {importing ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
          {importing
            ? 'Creating…'
            : previewTasks
              ? `Create all ${previewTasks.length} task${previewTasks.length === 1 ? '' : 's'}`
              : 'Create all tasks'}
        </button>
      </div>

      {previewTasks && previewTasks.length > 0 && (
        <div className="mt-5">
          {summary}
          <ul className="space-y-2">
            {previewTasks.map((task, index) => (
              <li
                key={`${task.title}-${index}`}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
              >
                <p className="text-sm font-semibold text-white">{task.title}</p>
                <div className="mt-1 text-xs text-slate-400">
                  {formatPreviewDate(task.reminderAt)} · {TONE_LABELS[task.nudgeTone] || task.nudgeTone}{' '}
                  · {QUOTE_LABELS[task.quotePreference.mode] || task.quotePreference.mode}
                </div>
                {task.description && (
                  <p className="mt-1 text-xs text-slate-300">{task.description}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
