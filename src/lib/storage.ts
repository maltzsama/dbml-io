const KEY = 'dbml-io-session';

export interface SessionState {
  theme: string;
  lineMode: string;
  showEditor: boolean;
  showLegend: boolean;
  dbmlCode: string;
}

const defaults: SessionState = {
  theme: 'dark',
  lineMode: 'ortho',
  showEditor: true,
  showLegend: true,
  dbmlCode: '',
};

export function loadSession(fallbackCode: string): SessionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults, dbmlCode: fallbackCode };
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed, dbmlCode: parsed.dbmlCode || fallbackCode };
  } catch {
    return { ...defaults, dbmlCode: fallbackCode };
  }
}

export function saveSession(state: SessionState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
  }
}
