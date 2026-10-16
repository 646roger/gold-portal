import Decimal from 'decimal.js';
import type { Msg } from './types';

/**
 * Backstop for "the model must never invent money". Every ₹ amount (and every application ID)
 * in assistant text must be traceable to a tool result in this conversation (or be a number the
 * user typed). Anything else is rejected and replaced by safe text.
 */
const RUPEE = /(?:₹|rs\.?|inr)\s*([\d][\d,]*(?:\.\d+)?)/gi;
const APP_ID = /\bGL-[A-Z0-9]{8}\b/g;

const norm = (s: string): string | null => {
  try {
    return new Decimal(s.replace(/,/g, '')).toString();
  } catch {
    return null;
  }
};

export function collectAllowed(messages: Msg[]): { numbers: Set<string>; ids: Set<string> } {
  const numbers = new Set<string>();
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant') continue;
    const text = m.content;
    for (const n of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      const v = norm(n);
      if (v) numbers.add(v);
    }
    if (m.role === 'tool') for (const id of text.match(APP_ID) ?? []) ids.add(id);
  }
  return { numbers, ids };
}

export function findUngroundedFigures(text: string, messages: Msg[]): string[] {
  const { numbers, ids } = collectAllowed(messages);
  const bad: string[] = [];
  for (const m of text.matchAll(RUPEE)) {
    const v = norm(m[1] ?? '');
    if (v === null || !numbers.has(v)) bad.push(m[0]);
  }
  for (const id of text.match(APP_ID) ?? []) if (!ids.has(id)) bad.push(id);
  return bad;
}
