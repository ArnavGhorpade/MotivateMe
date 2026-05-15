import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell,
  BellOff,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Quote,
  Repeat2,
  Sparkles,
  Target,
  Trash2,
  X
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { SignInScreen, AuthLoadingScreen } from './SignInScreen.jsx';
import { OwnerAuthProvider, useOwnerAuth } from './OwnerAuthContext.jsx';
import { OwnerLoginScreen } from './OwnerLoginScreen.jsx';
import { ProjectPlannerImport } from './ProjectPlannerImport.jsx';
import { authHeaders } from './apiToken.js';
import './styles.css';

const quoteModes = [
  { value: 'motivation', label: 'Motivation' },
  { value: 'wisdom', label: 'Wisdom' },
  { value: 'random', label: 'Random' },
  { value: 'custom', label: 'Custom message' }
];

const nudgeTones = [
  { value: 'supportive', label: 'Supportive', hint: 'Calm and encouraging.' },
  { value: 'direct', label: 'Direct', hint: 'Clear and action-oriented.' },
  { value: 'tough', label: 'Tough', hint: 'Disciplined coach. No-excuses.' }
];

const reminderOffsets = [
  { value: 0, label: 'At exact time' },
  { value: 5, label: '5 min before' },
  { value: 10, label: '10 min before' },
  { value: 20, label: '20 min before' },
  { value: 'custom', label: 'Custom minutes before' }
];

const repeatIntervals = [
  { value: 0, label: 'No repeat' },
  { value: 1, label: 'Every 1 min' },
  { value: 5, label: 'Every 5 min' },
  { value: 10, label: 'Every 10 min' },
  { value: 20, label: 'Every 20 min' },
  { value: 'custom', label: 'Custom interval' }
];

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

// authHeaders() returns {} when no session exists, so AUTH_MODE=off requests
// look identical to before. When a Supabase session is active it adds
// Authorization: Bearer <jwt>.
const api = {
  async listTasks() {
    const res = await fetch(apiUrl('/api/tasks'), { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error('Could not load tasks.');
    return res.json();
  },
  async createTask(payload) {
    const res = await fetch(apiUrl('/api/tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.errors?.join(' ') || 'Could not create task.');
    }
    return res.json();
  },
  async updateTask(id, payload) {
    const res = await fetch(apiUrl(`/api/tasks/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.errors?.join(' ') || body.error || 'Could not update task.');
    }
    return res.json();
  },
  async deleteTask(id) {
    const res = await fetch(apiUrl(`/api/tasks/${id}`), {
      method: 'DELETE',
      headers: { ...authHeaders() }
    });
    if (!res.ok) throw new Error('Could not delete task.');
  },
  async snoozeTask(id, minutes) {
    const res = await fetch(apiUrl(`/api/tasks/${id}/snooze`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ minutes })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Could not snooze task.');
    }
    return res.json();
  },
  async reorderTasks(orderedIds) {
    const res = await fetch(apiUrl('/api/tasks/order'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ order: orderedIds })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Could not reorder tasks.');
    }
    return res.json();
  }
};

function toLocalDateTimeValue(date = new Date(Date.now() + 30 * 60 * 1000)) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function formatReminder(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(date));
}

function App() {
  const { accessToken: supabaseAccessToken, authEnabled, user, signOut } = useAuth();
  const {
    accessToken: ownerAccessToken,
    gateEnabled: ownerGateEnabled,
    signOut: ownerSignOut
  } = useOwnerAuth();
  // Either auth path can be live; whichever sets a token wins. They are
  // mutually exclusive in practice (the deployed build uses the owner gate
  // OR Supabase auth, never both).
  const accessToken = ownerAccessToken || supabaseAccessToken;
  const [tasks, setTasks] = useState([]);
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [editCandidate, setEditCandidate] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerImporting, setPlannerImporting] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() =>
    'Notification' in window ? Notification.permission : 'unavailable'
  );
  // Independent of OS permission: the user can keep permission granted but
  // mute the app's notifications. Persisted so it survives reloads.
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try {
      const stored = window.localStorage.getItem('motivateme-notifications-enabled');
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });
  // Mirror in a ref so the SSE useEffect closure can read the latest value
  // without forcing the EventSource to reconnect on every toggle.
  const notificationsEnabledRef = useRef(notificationsEnabled);
  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
    try {
      window.localStorage.setItem(
        'motivateme-notifications-enabled',
        String(notificationsEnabled)
      );
    } catch {
      // ignore — private mode etc.
    }
  }, [notificationsEnabled]);
  // Track OS-level permission changes (user revokes/grants in browser settings)
  // via the Permissions API where it's supported.
  useEffect(() => {
    if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
      return;
    }
    let active = true;
    let status;
    navigator.permissions
      .query({ name: 'notifications' })
      .then((permissionStatus) => {
        if (!active) return;
        status = permissionStatus;
        setNotificationPermission(status.state);
        status.onchange = () => setNotificationPermission(status.state);
      })
      .catch(() => {
        // Some Safari versions reject querying 'notifications' — fall back
        // to the static value read at mount.
      });
    return () => {
      active = false;
      if (status) status.onchange = null;
    };
  }, []);
  const [form, setForm] = useState({
    title: '',
    description: '',
    reminderAt: toLocalDateTimeValue(),
    useNow: true,
    reminderOffsetMinutes: 0,
    repeatIntervalMinutes: 0,
    quotePreference: {
      mode: 'motivation',
      customMessage: '',
    },
    nudgeTone: 'supportive'
  });

  function addToast({ title, message, tone = 'info' }) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, title, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }

  // When the access token changes (login, refresh, sign-out) reload tasks so
  // the list reflects the right user. In AUTH_MODE=off this fires once with
  // accessToken=null and behaves identically to before.
  useEffect(() => {
    setLoading(true);
    api
      .listTasks()
      .then(setTasks)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => {
    const base = apiUrl('/api/reminders/stream');
    // EventSource cannot send headers, so the token rides as a query string.
    // Phase 6 will verify it server-side; in this phase the SSE endpoint is
    // still unauthenticated so the param is harmless when present.
    const url = accessToken
      ? `${base}?token=${encodeURIComponent(accessToken)}`
      : base;
    const events = new EventSource(url);
    events.addEventListener('reminder', (event) => {
      const reminder = JSON.parse(event.data);
      setBanner(reminder);
      setTasks((current) =>
        current.map((task) =>
          task.id === reminder.taskId
            ? {
                ...task,
                remindedAt: reminder.deliveredAt,
                lastReminder: reminder.quote,
                nextReminderAt: reminder.followUpAt,
                reminderCount: reminder.reminderCount
              }
            : task
        )
      );
      const quote = normalizeQuote(reminder.quote);
      addToast({
        title: `Reminder: ${reminder.taskTitle}`,
        message: quote.text,
        tone: 'reminder'
      });
      if (notificationsEnabledRef.current) {
        const bodyParts = [];
        if (quote.text) bodyParts.push(quote.text);
        if (quote.author && quote.author !== 'You') bodyParts.push(`— ${quote.author}`);
        if (reminder.taskDescription) bodyParts.push(reminder.taskDescription);
        showNotification({
          title: `MotivateMe: ${reminder.taskTitle}`,
          body: bodyParts.join('\n').trim() || 'Time to focus.',
          tag: `motivateme-task-${reminder.taskId}`
        });
      }
    });
    events.onerror = () => events.close();
    return () => events.close();
  }, [accessToken]);

  function showNotification({ title, body, tag }) {
    if (!('Notification' in window)) {
      return { ok: false, reason: 'unsupported' };
    }
    if (Notification.permission !== 'granted') {
      return { ok: false, reason: 'not-granted' };
    }
    try {
      const notification = new Notification(title, {
        body,
        tag,
        icon: '/motivateme-icon-192.png',
        badge: '/favicon-32.png',
        renotify: Boolean(tag)
      });
      notification.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        try {
          notification.close();
        } catch {
          /* ignore */
        }
      };
      return { ok: true, notification };
    } catch (err) {
      return { ok: false, reason: 'threw', error: err };
    }
  }

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) {
      setNotificationPermission('unavailable');
      addToast({
        title: 'Browser notifications unavailable',
        message: 'This browser does not support the Notification API. In-app reminders still work.',
        tone: 'warning'
      });
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') {
      setNotificationsEnabled(true);
      addToast({
        title: 'Browser notifications enabled',
        message: 'Send a test to confirm macOS isn’t suppressing them.',
        tone: 'success'
      });
    } else if (permission === 'denied') {
      addToast({
        title: 'Browser notifications blocked',
        message:
          'macOS: System Settings → Notifications → your browser. Then click the site lock icon to allow this site.',
        tone: 'warning'
      });
    } else {
      addToast({
        title: 'Browser notifications off',
        message: 'No worries. In-app reminders will keep working.',
        tone: 'warning'
      });
    }
  }

  function toggleAppNotifications() {
    setNotificationsEnabled((current) => {
      const next = !current;
      addToast({
        title: next ? 'Notifications enabled' : 'Notifications disabled',
        message: next
          ? 'Reminders will trigger a desktop notification when this tab is open.'
          : 'Reminders will only show in-app while this tab is open.',
        tone: next ? 'success' : 'info'
      });
      return next;
    });
  }

  function sendTestNotification() {
    const result = showNotification({
      title: 'MotivateMe test notification',
      body: 'If you can see this, browser notifications are wired up. Reminders will use the same path.',
      tag: 'motivateme-test'
    });
    if (result.ok) {
      addToast({
        title: 'Test notification sent',
        message:
          'If you didn’t see it, check macOS System Settings → Notifications → your browser, and turn off Do Not Disturb.',
        tone: 'success'
      });
    } else if (result.reason === 'unsupported') {
      addToast({
        title: 'Notifications unsupported',
        message: 'This browser does not support the Notification API.',
        tone: 'error'
      });
    } else if (result.reason === 'not-granted') {
      addToast({
        title: 'Permission required',
        message: 'Click Enable browser notifications first.',
        tone: 'warning'
      });
    } else {
      addToast({
        title: 'Test notification failed',
        message: result.error?.message || 'The browser refused to display the notification.',
        tone: 'error'
      });
    }
  }

  function showDeniedHelp() {
    addToast({
      title: 'Notifications are blocked',
      message:
        'macOS: System Settings → Notifications → your browser → Allow. Safari: Settings → Websites → Notifications. Chrome/Edge: site lock icon → Site settings → Notifications → Allow.',
      tone: 'warning'
    });
  }

  const stats = useMemo(() => {
    const completed = tasks.filter((task) => task.completed).length;
    return {
      completed,
      pending: tasks.length - completed
    };
  }, [tasks]);

  const activeTasks = useMemo(
    () =>
      tasks
        .filter((task) => !task.completed)
        .sort((a, b) => {
          const aOrder = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
          const bOrder = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
          if (aOrder !== bOrder) return aOrder - bOrder;
          const aTime = a.nextReminderAt ? new Date(a.nextReminderAt).getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.nextReminderAt ? new Date(b.nextReminderAt).getTime() : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        }),
    [tasks]
  );

  const completedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.completed)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [tasks]
  );

  const focusTask = activeTasks[0] || null;

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const reminderAt = form.useNow
        ? new Date().toISOString()
        : new Date(form.reminderAt).toISOString();
      const reminderOffsetMinutes = form.useNow ? 0 : form.reminderOffsetMinutes;
      const task = await api.createTask({
        title: form.title,
        description: form.description,
        reminderAt,
        reminderOffsetMinutes,
        repeatIntervalMinutes: form.repeatIntervalMinutes,
        quotePreference: form.quotePreference,
        nudgeTone: form.nudgeTone
      });
      setTasks((current) => [task, ...current]);
      setForm({
        title: '',
        description: '',
        reminderAt: toLocalDateTimeValue(),
        useNow: true,
        reminderOffsetMinutes: 0,
        repeatIntervalMinutes: 0,
        quotePreference: {
          mode: 'motivation',
          customMessage: '',
        },
        nudgeTone: 'supportive'
      });
      addToast({
        title: 'Task created',
        message: `"${task.title}" is scheduled for ${formatReminder(task.nextReminderAt || task.reminderAt)}.`,
        tone: 'success'
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleComplete(task) {
    const updated = await api.updateTask(task.id, { completed: !task.completed });
    setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)));
    if (!task.completed && updated.completed) {
      const id = crypto.randomUUID();
      setCelebration({ id });
      window.setTimeout(() => {
        setCelebration((current) => (current?.id === id ? null : current));
      }, 2400);
    }
    addToast({
      title: updated.completed ? 'Task completed' : 'Task reopened',
      message: `"${updated.title}" ${updated.completed ? 'will stop sending reminders.' : 'is active again.'}`,
      tone: updated.completed ? 'success' : 'info'
    });
  }

  async function confirmDeleteTask(task) {
    const previous = tasks;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    setDeleteCandidate(null);
    setError('');
    try {
      await api.deleteTask(task.id);
      addToast({
        title: 'Task deleted',
        message: `"${task.title}" was removed and its reminders stopped.`,
        tone: 'success'
      });
    } catch (err) {
      setTasks(previous);
      setError(err.message);
      addToast({
        title: 'Delete failed',
        message: err.message,
        tone: 'error'
      });
    }
  }

  function openEdit(task) {
    setEditError('');
    setEditCandidate(task);
  }

  function closeEdit() {
    if (editSaving) return;
    setEditCandidate(null);
    setEditError('');
  }

  async function handleEditSave(payload) {
    if (!editCandidate) return;
    setEditSaving(true);
    setEditError('');
    try {
      const updated = await api.updateTask(editCandidate.id, payload);
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setBanner((current) => (current?.taskId === updated.id ? null : current));
      setEditCandidate(null);
      addToast({
        title: 'Task updated',
        message: `"${updated.title}" was saved.`,
        tone: 'success'
      });
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSnoozeTask(taskId, minutes) {
    const previous = tasks;
    try {
      const updated = await api.snoozeTask(taskId, minutes);
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setBanner((current) =>
        current?.taskId === updated.id ? { ...current, followUpAt: updated.nextReminderAt } : current
      );
      addToast({
        title: `Snoozed ${minutes} minutes`,
        message: `Next reminder: ${formatReminder(updated.nextReminderAt)}.`,
        tone: 'success'
      });
    } catch (err) {
      setTasks(previous);
      addToast({ title: 'Snooze failed', message: err.message, tone: 'error' });
    }
  }

  async function handleReorderActive(orderedIds) {
    const previous = tasks;
    setTasks((current) => {
      const indexById = new Map(orderedIds.map((id, index) => [id, index]));
      return current.map((task) =>
        indexById.has(task.id) ? { ...task, order: indexById.get(task.id) } : task
      );
    });
    try {
      const updatedTasks = await api.reorderTasks(orderedIds);
      setTasks(updatedTasks);
    } catch (err) {
      setTasks(previous);
      addToast({ title: 'Could not save order', message: err.message, tone: 'error' });
    }
  }

  async function handlePlannerImport(plannerTasks) {
    if (!Array.isArray(plannerTasks) || plannerTasks.length === 0) return;
    setPlannerImporting(true);
    const created = [];
    let failedAt = -1;
    let failureMessage = '';
    // Create newest-last so the earliest-due task ends up at the top of the
    // active list. The backend assigns each new task an order that's smaller
    // than every existing active task, so iterating in reverse keeps the
    // visible order aligned with the AI's intended sequence.
    const reversed = plannerTasks.slice().reverse();
    try {
      for (let i = 0; i < reversed.length; i++) {
        const task = await api.createTask(reversed[i]);
        created.push(task);
      }
    } catch (err) {
      failedAt = created.length;
      failureMessage = err.message || 'Could not import a task.';
    }

    if (created.length > 0) {
      setTasks((current) => [...created, ...current]);
    }

    if (failureMessage) {
      addToast({
        title: 'Import partially failed',
        message: `Imported ${created.length} of ${plannerTasks.length} tasks before stopping at #${
          failedAt + 1
        }: ${failureMessage}`,
        tone: 'error'
      });
      setPlannerImporting(false);
      throw new Error(failureMessage);
    }

    setPlannerImporting(false);
    setPlannerOpen(false);
    addToast({
      title: 'Project imported',
      message: `Created ${created.length} task${created.length === 1 ? '' : 's'} from your project plan.`,
      tone: 'success'
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.38),transparent_36%),linear-gradient(120deg,rgba(37,99,235,0.28),rgba(168,85,247,0.22),transparent_62%)]" />
      <section className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 py-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm text-blue-100 shadow-glow backdrop-blur">
              Project by Arnav Ghorpade
            </div>
            <h1 className="text-4xl font-semibold tracking-normal text-white sm:text-5xl">
              MotivateMe
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
              Plan the next task, choose motivation or wisdom, and get a small burst of
              encouragement when it is time to begin.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:w-64">
            <StatCard icon={<Clock3 size={18} />} label="Pending" value={stats.pending} />
            <StatCard icon={<CheckCircle2 size={18} />} label="Done" value={stats.completed} />
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {authEnabled && user && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-slate-200 shadow-glow backdrop-blur">
              <span className="truncate text-slate-300">{user.email}</span>
              <button
                onClick={() => signOut()}
                className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-semibold text-slate-100 transition hover:bg-white/15"
              >
                Sign out
              </button>
            </div>
          )}
          {ownerGateEnabled && !authEnabled && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-slate-200 shadow-glow backdrop-blur">
              <span className="text-slate-300">Owner</span>
              <button
                onClick={() => ownerSignOut()}
                className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-semibold text-slate-100 transition hover:bg-white/15"
              >
                Sign out
              </button>
            </div>
          )}
          <NotificationSettings
            permission={notificationPermission}
            enabled={notificationsEnabled}
            onEnable={enableBrowserNotifications}
            onToggle={toggleAppNotifications}
            onTest={sendTestNotification}
            onShowDeniedHelp={showDeniedHelp}
          />
        </div>

        {banner && <ReminderBanner reminder={banner} onClose={() => setBanner(null)} />}

        {error && (
          <div className="rounded-lg border border-rose-400/30 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        <TodayFocus
          task={focusTask}
          loading={loading}
          onToggleComplete={toggleComplete}
          onSnooze={handleSnoozeTask}
          onEdit={openEdit}
        />

        <ActiveTaskList
          loading={loading}
          tasks={activeTasks}
          onToggleComplete={toggleComplete}
          onDeleteTask={setDeleteCandidate}
          onEditTask={openEdit}
          onReorder={handleReorderActive}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-400">
            Have a bigger project? Generate scheduled tasks from a plan.
          </div>
          <button
            type="button"
            onClick={() => setPlannerOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/15"
          >
            <Sparkles size={16} />
            Break down a project
          </button>
        </div>

        <TaskForm form={form} setForm={setForm} saving={saving} onSubmit={handleSubmit} />

        <CompletedTaskList
          tasks={completedTasks}
          onToggleComplete={toggleComplete}
          onDeleteTask={setDeleteCandidate}
          onEditTask={openEdit}
        />
      </section>
      {celebration && <CompletionCelebration />}
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      {deleteCandidate && (
        <ConfirmDeleteModal
          task={deleteCandidate}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => confirmDeleteTask(deleteCandidate)}
        />
      )}
      {editCandidate && (
        <EditTaskModal
          key={editCandidate.id}
          task={editCandidate}
          onCancel={closeEdit}
          onSave={handleEditSave}
          saving={editSaving}
          error={editError}
        />
      )}
      {plannerOpen && (
        <ProjectPlannerImport
          onCancel={() => (plannerImporting ? null : setPlannerOpen(false))}
          onImport={handlePlannerImport}
          importing={plannerImporting}
        />
      )}
    </main>
  );
}

function CompletionCelebration() {
  const pieces = Array.from({ length: 18 }, (_, index) => ({
    id: index,
    left: 12 + ((index * 43) % 76),
    delay: (index % 6) * 0.045,
    drift: ((index % 5) - 2) * 18,
    color: ['#60a5fa', '#a78bfa', '#34d399', '#f0abfc'][index % 4]
  }));

  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center px-4">
      <div className="completion-confetti" aria-hidden="true">
        {pieces.map((piece) => (
          <span
            key={piece.id}
            style={{
              '--left': `${piece.left}%`,
              '--delay': `${piece.delay}s`,
              '--drift': `${piece.drift}px`,
              '--color': piece.color
            }}
          />
        ))}
      </div>
      <div className="completion-card rounded-lg border border-emerald-300/20 bg-slate-950/90 p-6 text-center shadow-glow backdrop-blur">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/25">
          <CheckCircle2 size={38} strokeWidth={1.8} />
        </div>
        <h2 className="mt-4 text-2xl font-semibold text-white">Task completed</h2>
        <p className="mt-2 text-sm text-slate-300">Nice work — your progress was saved.</p>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/10 p-4 shadow-glow backdrop-blur">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

function NotificationSettings({
  permission,
  enabled,
  onEnable,
  onToggle,
  onTest,
  onShowDeniedHelp
}) {
  if (permission === 'unavailable') {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-400"
        title="This browser does not support the Notification API."
      >
        <BellOff size={14} />
        Notifications unsupported
      </div>
    );
  }
  if (permission === 'denied') {
    return (
      <button
        type="button"
        onClick={onShowDeniedHelp}
        className="inline-flex items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/15"
        title="Click for setup help"
      >
        <BellOff size={14} />
        Notifications blocked
      </button>
    );
  }
  if (permission !== 'granted') {
    return (
      <button
        type="button"
        onClick={onEnable}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
      >
        <Bell size={14} />
        Enable browser notifications
      </button>
    );
  }
  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
      <span className="inline-flex items-center gap-1.5 px-1 text-xs font-semibold text-slate-200">
        <Bell size={13} className={enabled ? 'text-emerald-200' : 'text-slate-400'} />
        Notifications {enabled ? 'on' : 'off'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/15"
      >
        {enabled ? 'Disable' : 'Enable'}
      </button>
      <button
        type="button"
        onClick={onTest}
        className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/15"
      >
        Test
      </button>
    </div>
  );
}

function ReminderBanner({ reminder, onClose }) {
  const quote = normalizeQuote(reminder.quote);
  const sourceLabel = reminderSourceLabel(reminder.quote);
  const toneLabel = nudgeToneLabel(reminder.nudgeTone || quote.tone);
  return (
    <div className="rounded-lg border border-blue-300/30 bg-blue-500/15 p-4 shadow-glow backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-purple-400 text-white">
            <Bell size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold text-blue-100">Reminder for {reminder.taskTitle}</p>
            <p className="mt-1 text-lg leading-7 text-white">{quote.text}</p>
            <p className="mt-2 text-sm text-slate-300">- {quote.author}</p>
            <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">
              {sourceLabel} · {toneLabel} tone
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss reminder"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

function TaskFormFields({ form, setForm, idPrefix = 'create' }) {
  const titleId = `${idPrefix}-title`;
  const descId = `${idPrefix}-description`;
  const reminderId = `${idPrefix}-reminderAt`;
  const customMsgId = `${idPrefix}-customMessage`;
  return (
    <>
      <label className="field-label" htmlFor={titleId}>
        Title
      </label>
      <input
        id={titleId}
        required
        value={form.title}
        onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
        placeholder="Finish biology lab summary"
        className="field-input"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={true}
      />

      <label className="field-label mt-4" htmlFor={descId}>
        Description
      </label>
      <textarea
        id={descId}
        rows="4"
        value={form.description}
        onChange={(event) =>
          setForm((current) => ({ ...current, description: event.target.value }))
        }
        placeholder="Optional notes, links, or study context"
        className="field-input resize-none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={true}
      />

      <label className="field-label mt-4" htmlFor={reminderId}>
        Reminder time
      </label>
      {form.useNow ? (
        <div className="field-input flex items-center justify-between gap-3">
          <span className="text-slate-100">Start now</span>
          <button
            type="button"
            onClick={() => setForm((current) => ({ ...current, useNow: false }))}
            className="text-sm font-semibold text-blue-200 transition hover:text-blue-100"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            id={reminderId}
            required
            type="datetime-local"
            value={form.reminderAt}
            onChange={(event) =>
              setForm((current) => ({ ...current, reminderAt: event.target.value }))
            }
            className="field-input"
          />
          <button
            type="button"
            onClick={() => setForm((current) => ({ ...current, useNow: true }))}
            className="mt-2 text-xs font-semibold text-blue-200 transition hover:text-blue-100"
          >
            Use now
          </button>
        </>
      )}

      {!form.useNow && (
        <fieldset className="mt-4">
          <legend className="field-label">Reminder timing</legend>
          <select
            value={presetOrCustom(form.reminderOffsetMinutes, [0, 5, 10, 20])}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                reminderOffsetMinutes:
                  event.target.value === 'custom' ? 30 : Number(event.target.value)
              }))
            }
            className="field-input"
          >
            {reminderOffsets.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {presetOrCustom(form.reminderOffsetMinutes, [0, 5, 10, 20]) === 'custom' && (
            <input
              type="number"
              min="1"
              max="1440"
              value={form.reminderOffsetMinutes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reminderOffsetMinutes: Number(event.target.value)
                }))
              }
              className="field-input mt-2"
              aria-label="Custom minutes before"
            />
          )}
        </fieldset>
      )}

      <fieldset className="mt-4">
        <legend className="field-label">Repeat nudges</legend>
        <select
          value={presetOrCustom(form.repeatIntervalMinutes, [0, 1, 5, 10, 20])}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              repeatIntervalMinutes:
                event.target.value === 'custom' ? 30 : Number(event.target.value)
            }))
          }
          className="field-input"
        >
          {repeatIntervals.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {presetOrCustom(form.repeatIntervalMinutes, [0, 1, 5, 10, 20]) === 'custom' && (
          <input
            type="number"
            min="1"
            max="1440"
            value={form.repeatIntervalMinutes}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                repeatIntervalMinutes: Number(event.target.value)
              }))
            }
            className="field-input mt-2"
            aria-label="Custom repeat minutes"
          />
        )}
      </fieldset>

      <fieldset className="mt-4">
        <legend className="field-label">Reminder style</legend>
        <div className="grid grid-cols-2 gap-2">
          {quoteModes.map((mode) => {
            const active = form.quotePreference.mode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    quotePreference: {
                      ...current.quotePreference,
                      mode: mode.value
                    }
                  }))
                }
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'border-blue-300/60 bg-blue-400/20 text-white'
                    : 'border-white/10 bg-slate-950/40 text-slate-300 hover:bg-white/10'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {form.quotePreference.mode === 'custom' && (
        <>
          <label className="field-label mt-4" htmlFor={customMsgId}>
            Custom message
          </label>
          <textarea
            id={customMsgId}
            required
            rows="3"
            value={form.quotePreference.customMessage}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                quotePreference: {
                  ...current.quotePreference,
                  customMessage: event.target.value
                }
              }))
            }
            placeholder="You chose this time. Take one steady step."
            className="field-input resize-none"
          />
        </>
      )}

      <fieldset className="mt-4">
        <legend className="field-label">Nudge tone</legend>
        <p className="mb-2 text-xs text-slate-400">
          Sets the tone of repeat nudges if the task stays incomplete.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {nudgeTones.map((tone) => {
            const active = form.nudgeTone === tone.value;
            return (
              <button
                key={tone.value}
                type="button"
                onClick={() =>
                  setForm((current) => ({ ...current, nudgeTone: tone.value }))
                }
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'border-blue-300/60 bg-blue-400/20 text-white'
                    : 'border-white/10 bg-slate-950/40 text-slate-300 hover:bg-white/10'
                }`}
                aria-pressed={active}
              >
                {tone.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {nudgeTones.find((tone) => tone.value === form.nudgeTone)?.hint}
        </p>
      </fieldset>
    </>
  );
}

function TaskForm({ form, setForm, saving, onSubmit }) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-white/10 bg-white/[0.08] p-5 shadow-glow backdrop-blur"
    >
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-white text-slate-950">
          <Target size={20} />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white">Create task</h2>
          <p className="text-sm text-slate-400">Give your future self a clear next move.</p>
        </div>
      </div>

      <TaskFormFields form={form} setForm={setForm} idPrefix="create" />

      <button
        disabled={saving}
        className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:scale-[1.01] hover:from-blue-400 hover:to-purple-400 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {saving ? <Loader2 className="animate-spin" size={19} /> : <Plus size={19} />}
        Add task
      </button>
    </form>
  );
}

function EditTaskModal({ task, onCancel, onSave, saving, error }) {
  const [form, setForm] = useState(() => ({
    title: task.title || '',
    description: task.description || '',
    reminderAt: toLocalDateTimeValue(new Date(task.reminderAt)),
    useNow: false,
    reminderOffsetMinutes: Number.isFinite(task.reminderOffsetMinutes) ? task.reminderOffsetMinutes : 0,
    repeatIntervalMinutes: Number.isFinite(task.repeatIntervalMinutes) ? task.repeatIntervalMinutes : 0,
    quotePreference: {
      mode: task.quotePreference?.mode || 'motivation',
      customMessage: task.quotePreference?.customMessage || ''
    },
    nudgeTone: task.nudgeTone || 'supportive'
  }));

  function handleSubmit(event) {
    event.preventDefault();
    const reminderAt = form.useNow
      ? new Date().toISOString()
      : new Date(form.reminderAt).toISOString();
    const reminderOffsetMinutes = form.useNow ? 0 : form.reminderOffsetMinutes;
    onSave({
      title: form.title,
      description: form.description,
      reminderAt,
      reminderOffsetMinutes,
      repeatIntervalMinutes: form.repeatIntervalMinutes,
      quotePreference: form.quotePreference,
      nudgeTone: form.nudgeTone
    });
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-5 shadow-glow">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-slate-950">
              <Pencil size={19} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Edit task</h2>
              <p className="text-sm text-slate-400">Update the reminder details below.</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            type="button"
            className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Close edit dialog"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <TaskFormFields form={form} setForm={setForm} idPrefix={`edit-${task.id}`} />

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:from-blue-400 hover:to-purple-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TodayFocus({ task, loading, onToggleComplete, onSnooze, onEdit }) {
  if (loading) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/[0.05] p-6 shadow-glow backdrop-blur">
        <div className="flex items-center gap-2 text-slate-300">
          <Loader2 className="animate-spin" size={18} />
          Loading focus
        </div>
      </section>
    );
  }

  if (!task) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/[0.05] p-6 shadow-glow backdrop-blur">
        <p className="text-xs uppercase tracking-[0.18em] text-blue-200/80">Today focus</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Nothing on the line.</h2>
        <p className="mt-2 text-sm text-slate-400">
          Create a task below to set your next focus.
        </p>
      </section>
    );
  }

  const lastReminderQuote = task.lastReminder ? normalizeQuote(task.lastReminder) : null;
  const lastReminderLabel = task.lastReminder ? reminderSourceLabel(task.lastReminder) : null;
  const nextReminderLabel = task.nextReminderAt ? formatReminder(task.nextReminderAt) : null;

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.05] p-6 shadow-glow backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-blue-200/80">Today focus</p>
          <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{task.title}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
            <span className="inline-flex items-center gap-2">
              <Clock3 size={15} className="text-blue-200" />
              {nextReminderLabel ? `Next nudge ${nextReminderLabel}` : 'No reminder scheduled'}
            </span>
            <span className="inline-flex items-center gap-2">
              <Target size={15} className="text-purple-200" />
              {nudgeToneLabel(task.nudgeTone)} tone
            </span>
          </div>
        </div>
      </div>

      {lastReminderQuote?.text && (
        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
          <p className="text-sm italic leading-6 text-slate-100">"{lastReminderQuote.text}"</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
            {lastReminderQuote.author} · {lastReminderLabel}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onToggleComplete(task)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-slate-950 transition hover:bg-blue-50"
        >
          <Check size={17} />
          Mark done
        </button>
        <button
          onClick={() => onEdit(task)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
        >
          <Pencil size={16} />
          Edit
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-400">Snooze</span>
          {[5, 10, 20].map((minutes) => (
            <button
              key={minutes}
              onClick={() => onSnooze(task.id, minutes)}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-blue-50 transition hover:bg-white/15"
            >
              {minutes}m
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActiveTaskList({ loading, tasks, onToggleComplete, onDeleteTask, onEditTask, onReorder }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const taskIds = tasks.map((task) => task.id);

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = taskIds.indexOf(active.id);
    const newIndex = taskIds.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(taskIds, oldIndex, newIndex);
    onReorder(next);
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.08] p-5 shadow-glow backdrop-blur">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Active tasks</h2>
          <p className="text-sm text-slate-400">Drag to reorder. The top task drives Today focus.</p>
        </div>
        <CalendarClock className="text-blue-200" size={24} />
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-slate-300">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading tasks
        </div>
      ) : tasks.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-lg border border-dashed border-white/15 bg-white/[0.04] px-6 text-center text-slate-400">
          <p>No active tasks. Add one below to set your next focus.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {tasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  onToggleComplete={onToggleComplete}
                  onDeleteTask={onDeleteTask}
                  onEditTask={onEditTask}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function CompletedTaskList({ tasks, onToggleComplete, onDeleteTask, onEditTask }) {
  const [expanded, setExpanded] = useState(false);
  if (tasks.length === 0) return null;

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-glow backdrop-blur">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div>
          <h2 className="text-xl font-semibold text-white">Completed</h2>
          <p className="text-sm text-slate-400">
            {tasks.length} task{tasks.length === 1 ? '' : 's'} finished.
          </p>
        </div>
        <ChevronDown
          size={18}
          className={`text-slate-300 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-4 space-y-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggleComplete={onToggleComplete}
              onDeleteTask={onDeleteTask}
              onEditTask={onEditTask}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SortableTaskCard({ task, onToggleComplete, onDeleteTask, onEditTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1
  };
  return (
    <div ref={setNodeRef} style={style}>
      <TaskCard
        task={task}
        onToggleComplete={onToggleComplete}
        onDeleteTask={onDeleteTask}
        onEditTask={onEditTask}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function TaskCard({ task, onToggleComplete, onDeleteTask, onEditTask, dragHandleProps }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="rounded-lg border border-white/10 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          {dragHandleProps && (
            <button
              type="button"
              {...dragHandleProps}
              className="mt-1 inline-flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-200 active:cursor-grabbing"
              aria-label={`Drag to reorder ${task.title}`}
            >
              <GripVertical size={16} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className={`text-lg font-semibold ${
                  task.completed ? 'text-slate-400 line-through' : 'text-white'
                }`}
              >
                {task.title}
              </h3>
              <StatusBadge task={task} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Clock3 size={16} />
                Scheduled {formatReminder(task.reminderAt)}
              </span>
            </div>
            <TaskQuote task={task} compact />
            <button
              onClick={() => setExpanded((current) => !current)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold text-blue-200 transition hover:bg-white/10"
            >
              <ChevronDown
                size={16}
                className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
              Details
            </button>
            {expanded && (
              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                {task.description && (
                  <p className="mb-3 text-sm leading-6 text-slate-300">{task.description}</p>
                )}
                <TaskReminderDetails task={task} />
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:flex-nowrap">
          <button
            onClick={() => onToggleComplete(task)}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition ${
              task.completed
                ? 'bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
                : 'bg-white text-slate-950 hover:bg-blue-50'
            }`}
          >
            <Check size={17} />
            {task.completed ? 'Completed' : 'Mark done'}
          </button>
          <button
            onClick={() => onEditTask(task)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            <Pencil size={16} />
            Edit
          </button>
          <button
            onClick={() => onDeleteTask(task)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-300/20 px-4 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/10"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="fixed right-4 top-4 z-50 flex w-[min(92vw,24rem)] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-lg border p-4 shadow-glow backdrop-blur ${toastToneClass(toast.tone)}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{toast.title}</p>
              {toast.message && (
                <p className="mt-1 text-sm leading-5 text-slate-300">{toast.message}</p>
              )}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="rounded-lg p-1 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfirmDeleteModal({ task, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 p-5 shadow-glow">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-400/15 text-rose-200">
            <Trash2 size={19} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Delete task?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              This removes "{task.title}" and stops any scheduled reminders or snoozes.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskQuote({ task, compact = false }) {
  const seed =
    task.lastReminder ||
    (task.quotePreference?.mode === 'custom'
      ? {
          text: task.quotePreference.customMessage,
          author: 'You',
          type: 'custom',
          source: 'custom'
        }
      : null);
  const quote = normalizeQuote(seed);

  if (!quote.text) {
    return (
      <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-400">
        <Quote size={15} />
        {quoteModeLabel(task.quotePreference?.mode)} reminder · {nudgeToneLabel(task.nudgeTone)} tone
      </div>
    );
  }

  const sourceLabel = task.lastReminder ? reminderSourceLabel(task.lastReminder) : 'Custom message';

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="flex items-start gap-2 text-sm leading-6 text-slate-200">
        <Quote size={15} className="mt-1 shrink-0 text-blue-200" />
        <span>{quote.text}</span>
      </div>
      {!compact && (
        <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
          {quote.author} · {sourceLabel}
        </div>
      )}
    </div>
  );
}

function TaskReminderDetails({ task }) {
  const lastReminderLabel = task.lastReminder
    ? reminderSourceLabel(task.lastReminder)
    : 'No reminder sent yet';
  return (
    <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex items-center gap-2 text-slate-400">
          <Bell size={15} className="text-blue-200" />
          Timing
        </div>
        <p className="mt-1 font-medium text-slate-100">
          {reminderOffsetLabel(task.reminderOffsetMinutes)}
        </p>
        <p className="text-xs text-slate-500">
          Next: {task.nextReminderAt ? formatReminder(task.nextReminderAt) : 'None scheduled'}
        </p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex items-center gap-2 text-slate-400">
          <Repeat2 size={15} className="text-purple-200" />
          Repeat
        </div>
        <p className="mt-1 font-medium text-slate-100">
          {repeatIntervalLabel(task.repeatIntervalMinutes)}
        </p>
        <p className="text-xs text-slate-500">Stops when complete or deleted</p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex items-center gap-2 text-slate-400">
          <Quote size={15} className="text-blue-200" />
          First reminder style
        </div>
        <p className="mt-1 font-medium text-slate-100">{quoteModeLabel(task.quotePreference?.mode)}</p>
        <p className="text-xs text-slate-500">
          Last sent: {lastReminderLabel}
        </p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex items-center gap-2 text-slate-400">
          <Target size={15} className="text-purple-200" />
          Nudge tone
        </div>
        <p className="mt-1 font-medium text-slate-100">{nudgeToneLabel(task.nudgeTone)}</p>
        <p className="text-xs text-slate-500">Used for repeat nudges</p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 md:col-span-2">
        <div className="flex items-center gap-2 text-slate-400">
          <CheckCircle2 size={15} className="text-emerald-200" />
          Sent
        </div>
        <p className="mt-1 font-medium text-slate-100">
          {task.reminderCount || 0} reminder{task.reminderCount === 1 ? '' : 's'}
        </p>
        <p className="text-xs text-slate-500">
          {task.remindedAt ? `Last: ${formatReminder(task.remindedAt)}` : 'No reminders yet'}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ task }) {
  const isDue = task.nextReminderAt && new Date(task.nextReminderAt).getTime() <= Date.now();
  const label = task.completed ? 'completed' : task.remindedAt ? 'reminded' : isDue ? 'due' : 'pending';
  const classes = {
    completed: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/20',
    reminded: 'bg-blue-400/15 text-blue-200 ring-blue-300/20',
    due: 'bg-amber-400/15 text-amber-200 ring-amber-300/20',
    pending: 'bg-purple-400/15 text-purple-200 ring-purple-300/20'
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${classes[label]}`}>
      {label}
    </span>
  );
}

function AuthGate() {
  const { authEnabled, loading, session } = useAuth();
  if (!authEnabled) return <App />;
  if (loading) return <AuthLoadingScreen />;
  if (!session) return <SignInScreen />;
  return <App />;
}

function OwnerGate({ children }) {
  const { loading, gateEnabled, authenticated } = useOwnerAuth();
  if (loading) return <AuthLoadingScreen />;
  if (gateEnabled && !authenticated) return <OwnerLoginScreen />;
  return children;
}

function Root() {
  return (
    <OwnerAuthProvider>
      <OwnerGate>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </OwnerGate>
    </OwnerAuthProvider>
  );
}

createRoot(document.getElementById('root')).render(<Root />);

function normalizeQuote(quote) {
  if (!quote) {
    return { text: '', author: '', type: '', source: '', tone: '', stage: '', sourceLabel: '', toneLabel: '' };
  }
  return {
    text: quote.text || quote.content || '',
    author: quote.author || 'Unknown',
    type: quote.type || 'motivation',
    source: quote.source || 'local',
    tone: quote.tone || '',
    stage: quote.stage || '',
    sourceLabel: quote.sourceLabel || '',
    toneLabel: quote.toneLabel || ''
  };
}

function nudgeToneLabel(tone) {
  return nudgeTones.find((item) => item.value === tone)?.label || 'Supportive';
}

function reminderSourceLabel(quote) {
  const normalized = normalizeQuote(quote);
  if (normalized.sourceLabel) return normalized.sourceLabel;
  if (normalized.source === 'custom' || normalized.type === 'custom') return 'Custom message';
  if (normalized.source === 'nudge' && normalized.stage === 'identity') return 'Identity nudge';
  if (normalized.source === 'nudge' && normalized.stage === 'micro-start') return 'Micro-start nudge';
  return 'Curated local quote';
}

function quoteModeLabel(mode = 'motivation') {
  return quoteModes.find((item) => item.value === mode)?.label || 'Motivation';
}

function reminderOffsetLabel(minutes = 0) {
  if (!minutes) return 'At exact scheduled time';
  return `${minutes} minutes before scheduled time`;
}

function repeatIntervalLabel(minutes = 0) {
  if (!minutes) return 'No repeat';
  return `Every ${minutes} minutes until complete`;
}

function presetOrCustom(value, presets) {
  return presets.includes(Number(value)) ? Number(value) : 'custom';
}

function toastToneClass(tone) {
  const classes = {
    success: 'border-emerald-300/20 bg-emerald-500/15',
    error: 'border-rose-300/25 bg-rose-500/15',
    warning: 'border-amber-300/25 bg-amber-500/15',
    reminder: 'border-blue-300/25 bg-blue-500/15',
    info: 'border-white/10 bg-white/[0.08]'
  };
  return classes[tone] || classes.info;
}
