export const nudgeTones = ['supportive', 'direct', 'tough'];
export const nudgeStages = ['initial', 'micro-start', 'identity'];

const microStartNudges = {
  supportive: [
    'Can you spend just 2 minutes on {title}?',
    'Start small: open {title} and make one tiny move.',
    'Just give {title} a couple of minutes — that is enough for now.',
    'Open {title} and take one easy first step.'
  ],
  direct: [
    'Open {title} and give it two focused minutes.',
    'You scheduled {title}. Take the first step now.',
    'Two focused minutes on {title}. Begin.',
    'Open {title}. Pick one small action and do it.'
  ],
  tough: [
    'No more avoiding it. Start {title} with two focused minutes.',
    'Stop negotiating with procrastination. Open {title} now.',
    'You said this mattered. Prove it with one small step on {title}.',
    'You do not need to feel ready. You need to begin.'
  ]
};

const identityNudges = {
  supportive: [
    'Future you will appreciate one small step on {title}.',
    'You are building momentum every time you start.',
    'Each tiny step on {title} is a vote for the person you want to be.',
    'Be kind to yourself by starting now.'
  ],
  direct: [
    'You scheduled {title}. Follow through with one small step.',
    'Consistency matters more than motivation. Start now.',
    'Reliable people finish what they start. Open {title}.',
    'Plans only count when you act on them. Take one step on {title}.'
  ],
  tough: [
    'You said this mattered. Prove it with one small step on {title}.',
    'You do not need to feel ready. You need to begin.',
    'Don\'t let {title} sit longer. Take control and start now.',
    'Discipline shows up here, on {title}, right now.'
  ]
};

const sourceLabels = {
  'micro-start': 'Micro-start nudge',
  identity: 'Identity nudge'
};

const toneLabels = {
  supportive: 'Supportive nudge',
  direct: 'Direct nudge',
  tough: 'Tough nudge'
};

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function normalizeTone(tone) {
  return nudgeTones.includes(tone) ? tone : 'supportive';
}

function fillTemplate(template, title) {
  const safeTitle = (title || 'this task').trim() || 'this task';
  return template.replaceAll('{title}', safeTitle);
}

export function generateNudge({ stage, tone, title }) {
  const normalizedTone = normalizeTone(tone);
  const library = stage === 'identity' ? identityNudges : microStartNudges;
  const stageKey = stage === 'identity' ? 'identity' : 'micro-start';
  const text = fillTemplate(sample(library[normalizedTone]), title);

  return {
    text,
    author: 'MotivateMe',
    type: stageKey,
    source: 'nudge',
    tone: normalizedTone,
    stage: stageKey,
    sourceLabel: sourceLabels[stageKey],
    toneLabel: toneLabels[normalizedTone]
  };
}

export function nudgeStageForCount(reminderCount) {
  const count = Number.isInteger(reminderCount) ? reminderCount : 0;
  if (count <= 0) return 'initial';
  if (count === 1) return 'micro-start';
  return 'identity';
}

export { sourceLabels, toneLabels };
