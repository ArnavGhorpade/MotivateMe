import { generateQuote, localQuotes, quoteModes, quoteTypes } from './quotes.js';

const generators = {
  quote: generateQuote
};

export async function generateContent(type, context) {
  const generator = generators[type];
  if (!generator) {
    throw new Error(`Unsupported content type: ${type}`);
  }
  return generator(context);
}

export function listContentTypes() {
  return Object.keys(generators);
}

export function listQuoteOptions() {
  return {
    modes: quoteModes,
    types: quoteTypes,
    quoteCount: localQuotes.length
  };
}
