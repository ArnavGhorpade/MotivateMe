export const quoteTypes = ['motivation', 'wisdom'];
export const quoteModes = ['motivation', 'wisdom', 'random', 'custom'];

export const localQuotes = [
  { text: 'Begin with the smallest useful step, then give it your full attention.', author: 'Unknown', type: 'motivation' },
  { text: 'Ten focused minutes can change the shape of the whole afternoon.', author: 'Unknown', type: 'motivation' },
  { text: 'Make the task smaller until starting feels obvious.', author: 'Unknown', type: 'motivation' },
  { text: 'Your first draft only has one job: exist.', author: 'Unknown', type: 'motivation' },
  { text: 'Open the assignment. Read the first line. That counts as movement.', author: 'Unknown', type: 'motivation' },
  { text: 'You do not need intensity. You need a start you can repeat.', author: 'Unknown', type: 'motivation' },
  { text: 'Small honest work beats a perfect plan postponed.', author: 'Unknown', type: 'motivation' },
  { text: 'Set a timer, silence the noise, and give this task one clean attempt.', author: 'Unknown', type: 'motivation' },
  { text: 'A finished paragraph teaches more than an imagined essay.', author: 'Unknown', type: 'motivation' },
  { text: 'Choose the next page, the next problem, the next note. Keep it concrete.', author: 'Unknown', type: 'motivation' },
  { text: 'This task does not need your whole life. It needs your next half hour.', author: 'Unknown', type: 'motivation' },
  { text: 'Your attention is a skill. Train it gently, one session at a time.', author: 'Unknown', type: 'motivation' },
  { text: 'A little done now is lighter than a lot avoided later.', author: 'Unknown', type: 'motivation' },
  { text: 'Do not wait for confidence. Build evidence.', author: 'Unknown', type: 'motivation' },
  { text: 'Start where your energy is, then let momentum meet you there.', author: 'Unknown', type: 'motivation' },
  { text: 'Protect this next block of time like it belongs to your future.', author: 'Unknown', type: 'motivation' },
  { text: 'Progress likes a clear desk, a clear task, and a real start.', author: 'Unknown', type: 'motivation' },
  { text: 'One careful page is better than ten imagined pages.', author: 'Unknown', type: 'motivation' },
  { text: 'Put your materials in front of you and begin before the task grows larger in your mind.', author: 'Unknown', type: 'motivation' },
  { text: 'The best way out is always through.', author: 'Robert Frost', type: 'motivation' },
  { text: 'Well begun is half done.', author: 'Aristotle', type: 'motivation' },
  { text: 'The journey of a thousand miles begins with a single step.', author: 'Laozi', type: 'motivation' },
  { text: 'You miss 100 percent of the shots you do not take.', author: 'Wayne Gretzky', type: 'motivation' },
  { text: 'What you do every day matters more than what you do once in a while.', author: 'Gretchen Rubin', type: 'motivation' },
  { text: 'Either write something worth reading or do something worth writing.', author: 'Benjamin Franklin', type: 'motivation' },
  { text: 'The secret of getting things done is to act.', author: 'Dante Alighieri', type: 'motivation' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Unknown', type: 'wisdom' },
  { text: 'Learning never exhausts the mind.', author: 'Leonardo da Vinci', type: 'wisdom' },
  { text: 'The roots of education are bitter, but the fruit is sweet.', author: 'Aristotle', type: 'wisdom' },
  { text: 'Tell me and I forget. Teach me and I remember. Involve me and I learn.', author: 'Unknown', type: 'wisdom' },
  { text: 'The beautiful thing about learning is that nobody can take it away from you.', author: 'B.B. King', type: 'wisdom' },
  { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin', type: 'wisdom' },
  { text: 'Patience and perseverance have a magical effect before which difficulties disappear.', author: 'John Quincy Adams', type: 'wisdom' },
  { text: 'We are what we repeatedly do.', author: 'Unknown', type: 'wisdom' },
  { text: 'Wisdom begins in wonder.', author: 'Unknown', type: 'wisdom' },
  { text: 'The expert in anything was once a beginner.', author: 'Unknown', type: 'wisdom' },
  { text: 'The only real mistake is the one from which we learn nothing.', author: 'Henry Ford', type: 'wisdom' },
  { text: 'The mind is not a vessel to be filled, but a fire to be kindled.', author: 'Unknown', type: 'wisdom' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin', type: 'wisdom' },
  { text: 'The noblest pleasure is the joy of understanding.', author: 'Leonardo da Vinci', type: 'wisdom' },
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', author: 'Thomas Edison', type: 'wisdom' },
  { text: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Unknown', type: 'wisdom' },
  { text: 'Quality is not an act, it is a habit.', author: 'Unknown', type: 'wisdom' },
  { text: 'If you wish to learn, teach.', author: 'Cicero', type: 'wisdom' },
  { text: 'The more I read, the more I acquire, the more certain I am that I know nothing.', author: 'Voltaire', type: 'wisdom' },
  { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Unknown', type: 'wisdom' },
  { text: 'Focus on being productive instead of busy.', author: 'Unknown', type: 'wisdom' },
  { text: 'The beginning is the most important part of the work.', author: 'Plato', type: 'wisdom' }
];

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function normalizeMode(mode) {
  return quoteModes.includes(mode) ? mode : 'motivation';
}

function localQuoteFor(mode) {
  const normalized = normalizeMode(mode);
  const type = normalized === 'random' ? sample(quoteTypes) : normalized;
  return {
    ...sample(localQuotes.filter((quote) => quote.type === type)),
    source: 'local'
  };
}

export async function generateQuote({ task }) {
  const preference = task.quotePreference || {};
  const mode = normalizeMode(preference.mode);

  if (mode === 'custom') {
    return {
      text: preference.customMessage?.trim() || 'You chose this moment for a reason. Begin now.',
      author: 'You',
      type: 'custom',
      source: 'custom'
    };
  }

  return localQuoteFor(mode);
}
