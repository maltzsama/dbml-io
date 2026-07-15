// ============================================================================
// DBML Parser — Tokenizer-based, full spec compliant
// ============================================================================

export interface TableField {
  name: string;
  type: string;
  isPK: boolean;
  isFK: boolean;
  note: string;
  notNull: boolean;
  unique: boolean;
  increment: boolean;
  defaultVal: string;
}

export interface Table {
  name: string;
  fields: TableField[];
  note: string;
  headerColor: string;
}

export interface EnumValue {
  value: string;
  note: string;
}

export interface Enum {
  name: string;
  values: EnumValue[];
}

export interface Ref {
  fromTable: string;
  fromField: string;
  toTable: string;
  toField: string;
  type: string;
}

export interface TableGroup {
  name: string;
  members: string[];
  note: string;
}

export interface ProjectInfo {
  name: string;
  databaseType: string;
  note: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface CompiledDBML {
  tables: Table[];
  refs: Ref[];
  enums: Enum[];
  enumLookup: Record<string, Enum>;
  tableGroups: TableGroup[];
  positions: Record<string, Position>;
  projectInfo: ProjectInfo | null;
  error: string | null;
}

// ---- Tokenizer ----

type TokenType =
  | 'keyword' | 'identifier' | 'string' | 'number'
  | '{' | '}' | '[' | ']' | ':' | ',' | '.'
  | 'relation' | 'eof';

interface Token {
  type: TokenType;
  value: string;
}

const KEYWORDS = new Set([
  'table', 'enum', 'ref', 'project', 'note', 'tablegroup',
  'indexes', 'records', 'checks', 'as',
]);

const RELATIONS = new Set(['>', '<', '-', '<>']);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  function peek(offset = 0): string { return src[i + offset] ?? ''; }

  while (i < src.length) {
    const ch = src[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

    // Single-line comment
    if (ch === '/' && peek(1) === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    // Multi-line comment
    if (ch === '/' && peek(1) === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && peek(1) === '/')) i++;
      i += 2;
      continue;
    }

    // Triple-quoted string
    if (ch === "'" && peek(1) === "'" && peek(2) === "'") {
      const start = i;
      i += 3;
      while (i < src.length && !(src[i] === "'" && peek(1) === "'" && peek(2) === "'")) i++;
      if (i < src.length) i += 3;
      tokens.push({ type: 'string', value: src.slice(start, i) });
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      const start = i;
      i++;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i++;
        i++;
      }
      if (i < src.length) i++;
      tokens.push({ type: 'string', value: src.slice(start, i) });
      continue;
    }

    // Backtick-quoted identifier
    if (ch === '`') {
      i++;
      const start = i;
      while (i < src.length && src[i] !== '`') i++;
      tokens.push({ type: 'identifier', value: src.slice(start, i) });
      if (i < src.length) i++;
      continue;
    }

    // Single-char tokens
    if ('{}[]:,.'.includes(ch)) {
      tokens.push({ type: ch as TokenType, value: ch });
      i++;
      continue;
    }

    // Relation tokens (may be multi-char)
    if (RELATIONS.has(ch) || (ch === '<' && peek(1) === '>')) {
      if (ch === '<' && peek(1) === '>') {
        tokens.push({ type: 'relation', value: '<>' });
        i += 2;
      } else if (RELATIONS.has(ch + peek(1))) {
        tokens.push({ type: 'relation', value: ch + peek(1) });
        i += 2;
      } else {
        tokens.push({ type: 'relation', value: ch });
        i++;
      }
      continue;
    }

    // Number
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(peek(1)))) {
      const start = i;
      if (ch === '-') i++;
      while (/[0-9.]/.test(src[i])) i++;
      tokens.push({ type: 'number', value: src.slice(start, i) });
      continue;
    }

    // Identifier or keyword (includes `#hexcolor`, `_names`)
    if (/[a-zA-Z_#]/.test(ch) || ch === '(') {
      const start = i;
      // Handle standalone parenthesized groups like (field1, field2) — NOT part of type
      if (ch === '(') {
        let depth = 1; i++;
        while (i < src.length && depth > 0) {
          if (src[i] === '(') depth++;
          if (src[i] === ')') depth--;
          if (depth > 0) i++;
        }
        if (i < src.length) i++;
        tokens.push({ type: 'identifier', value: src.slice(start, i) });
        continue;
      }
      while (i < src.length && /[\w#]/.test(src[i])) i++;
      const word = src.slice(start, i);
      tokens.push({ type: KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'identifier', value: word });
      continue;
    }

    i++; // skip unknown chars
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// ---- TokenStream ----

class TokenStream {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  peek(offset = 0): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  }

  consume(): Token {
    return this.tokens[this.pos++] ?? this.tokens[this.tokens.length - 1];
  }

  expect(...types: TokenType[]): Token {
    const t = this.peek();
    if (!types.includes(t.type)) {
      throw new Error(`Expected ${types.join(' or ')} but got ${t.type} ('${t.value}')`);
    }
    return this.consume();
  }

  skip(...types: TokenType[]): void {
    while (types.includes(this.peek().type)) this.consume();
  }

  maybe(...types: TokenType[]): Token | null {
    return types.includes(this.peek().type) ? this.consume() : null;
  }

  get isEof(): boolean { return this.peek().type === 'eof'; }
}

// ---- Parser ----

interface ParsedDBML {
  tables: Table[];
  refs: Ref[];
  enums: Enum[];
  aliases: Record<string, string>;
  tableGroups: TableGroup[];
  projectInfo: ProjectInfo | null;
  enumLookup: Record<string, Enum>;
}

function parseDBML(rawContent: string): ParsedDBML {
  const tokens = tokenize(rawContent);
  const ts = new TokenStream(tokens);

  const tables: Table[] = [];
  const refs: Ref[] = [];
  const enums: Enum[] = [];
  const aliases: Record<string, string> = {};
  const tableGroups: TableGroup[] = [];
  let projectInfo: ProjectInfo | null = null;

  function parseString(): string {
    const t = ts.expect('string');
    const v = t.value;
    if (v.startsWith("'''")) return v.slice(3, v.length - 3);
    return v.slice(1, v.length - 1);
  }

  function parseIdentifier(): string {
    return ts.expect('identifier').value;
  }

  function parseBracketBlock(): Token[] {
    ts.expect('[');
    const block: Token[] = [];
    let depth = 1;
    while (depth > 0) {
      const t = ts.consume();
      if (t.type === 'eof') break;
      if (t.type === '[') depth++;
      if (t.type === ']') depth--;
      if (depth > 0) block.push(t);
    }
    return block;
  }

  function settingsFromTokens(block: Token[]): ColumnSettings {
    const settings: ColumnSettings = {
      isPK: false, isFK: false, note: '', notNull: false, isNull: false,
      unique: false, increment: false, defaultVal: '', refs: [],
    };

    let i = 0;
    while (i < block.length) {
      const t = block[i];
      const val = t.value.toLowerCase();

      if (val === 'pk') { settings.isPK = true; i++; continue; }
      if (val === 'primary' && block[i + 1]?.value.toLowerCase() === 'key') { settings.isPK = true; i += 2; continue; }
      if (val === 'not' && block[i + 1]?.value.toLowerCase() === 'null') { settings.notNull = true; i += 2; continue; }
      if (val === 'null' && !settings.notNull) { settings.isNull = true; i++; continue; }
      if (val === 'unique') { settings.unique = true; i++; continue; }
      if (val === 'increment') { settings.increment = true; i++; continue; }

      if (val === 'note' && block[i + 1]?.type === ':') {
        settings.note = block[i + 2]?.value ?? '';
        if (block[i + 2]?.type === 'string') {
          const s = block[i + 2].value;
          settings.note = s.startsWith("'''") ? s.slice(3, s.length - 3) : s.slice(1, s.length - 1);
        }
        i += 3;
        continue;
      }

      if (val === 'default' && block[i + 1]?.type === ':') {
        const dv = block[i + 2];
        if (dv) {
          settings.defaultVal = dv.type === 'string'
            ? (dv.value.startsWith("'''") ? dv.value.slice(3, dv.value.length - 3) : dv.value.slice(1, dv.value.length - 1))
            : dv.value;
        }
        i += 3;
        continue;
      }

      if (val === 'ref' && block[i + 1]?.type === ':') {
        const rel = block[i + 2];
        const table = block[i + 3];
        const dot = block[i + 4];
        const field = block[i + 5];
        if (rel && table && dot?.type === '.' && field) {
          settings.refs.push({ type: rel.value, table: table.value, field: field.value });
          settings.isFK = true;
          i += 6;
          continue;
        }
        i += 2;
        continue;
      }

      if (val === 'headercolor' && block[i + 1]?.type === ':') {
        // headerColor is handled at table level, but skip it in column settings
        i += 3;
        continue;
      }

      i++;
    }

    return settings;
  }

  interface RefSetting {
    type: string;
    table: string;
    field: string;
  }

  interface ColumnSettings {
    isPK: boolean; isFK: boolean; note: string;
    notNull: boolean; isNull: boolean; unique: boolean;
    increment: boolean; defaultVal: string; refs: RefSetting[];
  }

  function kw(val: string): boolean {
    return ts.peek().type === 'keyword' && ts.peek().value.toLowerCase() === val.toLowerCase();
  }

  function parseTableHeader(): { name: string; alias: string | null; headerColor: string } {
    ts.expect('keyword');
    const name = parseIdentifier();
    const alias = kw('as') ? (ts.consume(), parseIdentifier()) : null;
    let headerColor = '';
    if (ts.peek().type === '[') {
      const block = parseBracketBlock();
      for (const t of block) {
        if (t.value.toLowerCase() === 'headercolor' && t.type === 'identifier') {
          const idx = block.indexOf(t);
          if (idx >= 0 && block[idx + 1]?.type === ':') {
            headerColor = block[idx + 2]?.value ?? '';
          }
        }
      }
    }
    return { name, alias, headerColor };
  }

  function parseTableBody(name: string, alias: string | null, headerColor: string): void {
    ts.expect('{');

    // Collect all tokens inside the body first
    const bodyTokens: Token[] = [];
    let depth = 1;
    while (depth > 0 && !ts.isEof) {
      const t = ts.consume();
      if (t.type === '{') depth++;
      if (t.type === '}') depth--;
      if (depth > 0) bodyTokens.push(t);
    }

    // Two-pass: first extract composite PK fields & table note, then parse fields
    const compositePKFields: string[] = [];
    let tableNote = '';

    // Pass 1: extract metadata from blocks
    for (let i = 0; i < bodyTokens.length; i++) {
      const t = bodyTokens[i];
      if (t.type === 'keyword') {
        const kwval = t.value.toLowerCase();
        if (kwval === 'note') {
          if (bodyTokens[i + 1]?.type === ':') {
            const sv = bodyTokens[i + 2];
            if (sv?.type === 'string') {
              const raw = sv.value;
              tableNote = raw.startsWith("'''") ? raw.slice(3, raw.length - 3) : raw.slice(1, raw.length - 1);
            }
            i += 2;
          } else if (bodyTokens[i + 1]?.type === '{') {
            // find string inside Note { ... }
            for (let j = i + 2; j < bodyTokens.length; j++) {
              if (bodyTokens[j]?.type === 'string') {
                const raw = bodyTokens[j].value;
                tableNote = raw.startsWith("'''") ? raw.slice(3, raw.length - 3) : raw.slice(1, raw.length - 1);
                break;
              }
              if (bodyTokens[j]?.type === '}') break;
            }
          }
          continue;
        }
        if (kwval === 'indexes') {
          // find the opening {, then parse entries until matching }
          let idxDepth = 0, idxStart = -1;
          for (let j = i + 1; j < bodyTokens.length; j++) {
            if (bodyTokens[j].type === '{') { idxDepth++; if (idxStart === -1) idxStart = j + 1; }
            else if (bodyTokens[j].type === '}') { idxDepth--; if (idxDepth === 0) break; }
          }
          continue;
        }
      }
      // Parenthesized identifier followed by [pk]
      if (t.type === 'identifier' && t.value.startsWith('(') && bodyTokens[i + 1]?.type === '[') {
        const bracketEnd = findBracketEnd(bodyTokens, i + 1);
        if (bracketEnd) {
          const inner = bodyTokens.slice(i + 2, bracketEnd);
          const s = settingsFromTokens(inner);
          if (s.isPK) {
            const innerFields = t.value.slice(1, -1);
            compositePKFields.push(...innerFields.split(',').map(f => f.trim()));
          }
        }
      }
    }

    // Pass 2: parse fields
    const fields: TableField[] = [];
    let i = 0;
    while (i < bodyTokens.length) {
      const t = bodyTokens[i];

      // Skip blocks and notes
      if (t.type === 'keyword') {
        const kwval = t.value.toLowerCase();
        if (kwval === 'note') {
          i += 2;
          if (bodyTokens[i]?.type === 'string') i++;
          else if (bodyTokens[i]?.type === '{') {
            let bd = 1; i++;
            while (i < bodyTokens.length && bd > 0) {
              if (bodyTokens[i].type === '{') bd++;
              if (bodyTokens[i].type === '}') bd--;
              i++;
            }
          }
          continue;
        }
        if (kwval === 'indexes' || kwval === 'checks') {
          i += 2;
          let bd = 1;
          while (i < bodyTokens.length && bd > 0) {
            if (bodyTokens[i].type === '{') bd++;
            if (bodyTokens[i].type === '}') { bd--; if (bd === 0) { i++; break; } }
            i++;
          }
          continue;
        }
        if (kwval === 'records') { i++; continue; }
      }

      // Regular field: identifier type [optional [settings]]
      if (t.type !== 'identifier') { i++; continue; }

      const fieldName = t.value;
      i++;

      let fieldType = '';
      if (i < bodyTokens.length) {
        const nt = bodyTokens[i];
        if (nt.type === 'identifier' || nt.type === 'keyword') {
          fieldType = nt.value;
          i++;
          if (i < bodyTokens.length && bodyTokens[i].type === 'identifier' && bodyTokens[i].value.startsWith('(')) {
            fieldType += bodyTokens[i].value;
            i++;
          }
        }
      }

      let fieldSettings: ColumnSettings = {
        isPK: false, isFK: false, note: '', notNull: false, isNull: false,
        unique: false, increment: false, defaultVal: '', refs: [],
      };

      if (i < bodyTokens.length && bodyTokens[i].type === '[') {
        const bracketEnd = findBracketEnd(bodyTokens, i);
        if (bracketEnd) {
          const inner = bodyTokens.slice(i + 1, bracketEnd);
          fieldSettings = settingsFromTokens(inner);
          i = bracketEnd + 1;
        }
      }

      fieldSettings.isPK = fieldSettings.isPK || compositePKFields.includes(fieldName);

      for (const r of fieldSettings.refs) {
        refs.push({
          fromTable: name,
          fromField: fieldName,
          toTable: r.table,
          toField: r.field,
          type: r.type,
        });
      }

      fields.push({
        name: fieldName,
        type: fieldType,
        isPK: fieldSettings.isPK,
        isFK: fieldSettings.isFK,
        note: fieldSettings.note,
        notNull: fieldSettings.notNull,
        unique: fieldSettings.unique,
        increment: fieldSettings.increment,
        defaultVal: fieldSettings.defaultVal,
      });
    }

    tables.push({ name, fields, note: tableNote, headerColor });
    if (alias) aliases[alias] = name;
  }

  function findBracketEnd(tokens: Token[], start: number): number | null {
    let d = 1;
    for (let j = start + 1; j < tokens.length; j++) {
      if (tokens[j].type === '[') d++;
      if (tokens[j].type === ']') { d--; if (d === 0) return j; }
    }
    return null;
  }

  function parseEnum(): void {
    ts.expect('keyword');
    const name = parseIdentifier();
    ts.expect('{');
    const values: EnumValue[] = [];
    while (ts.peek().type !== '}' && !ts.isEof) {
      if (ts.peek().type === '{') { ts.consume(); continue; }
      const valName = parseIdentifier();
      let note = '';
      if (ts.peek().type === '[') {
        const block = parseBracketBlock();
        const s = settingsFromTokens(block);
        note = s.note;
      }
      values.push({ value: valName, note });
    }
    ts.expect('}');
    enums.push({ name, values });
  }

  function parseShortRef(): void {
    // Ref: table.field > table.field
    ts.consume(); // consume the colon after Ref

    const fromTable = parseIdentifier();
    ts.expect('.');
    const fromField = parseIdentifier();

    // optional composite: (field1, field2)
    let fromComposite: string[] | null = null;
    const next = ts.peek();
    if (next.type === 'identifier' && next.value.startsWith('(')) {
      fromComposite = next.value.slice(1, -1).split(',').map(s => s.trim());
      ts.consume();
    }

    ts.skip('identifier'); // skip optional inline name

    const rel = ts.expect('relation').value;

    const toTable = parseIdentifier();
    ts.expect('.');
    const toField = parseIdentifier();

    let toComposite: string[] | null = null;
    const next2 = ts.peek();
    if (next2.type === 'identifier' && next2.value.startsWith('(')) {
      toComposite = next2.value.slice(1, -1).split(',').map(s => s.trim());
      ts.consume();
    }

    // optional bracket settings — skip
    if (ts.peek().type === '[') parseBracketBlock();

    if (fromComposite && toComposite && fromComposite.length === toComposite.length) {
      const fullFromTable = `${fromTable}.${fromField}`;
      const fullToTable = `${toTable}.${toField}`;
      for (let i = 0; i < fromComposite.length; i++) {
        refs.push({ fromTable: fullFromTable, fromField: fromComposite[i], toTable: fullToTable, toField: toComposite[i], type: rel });
      }
    } else {
      refs.push({ fromTable, fromField, toTable, toField, type: rel });
    }
  }

  function parseLongRef(): void {
    // Ref { ... }
    ts.expect('{');
    const fromTable = parseIdentifier();
    ts.expect('.');
    const fromField = parseIdentifier();
    const rel = ts.expect('relation').value;
    const toTable = parseIdentifier();
    ts.expect('.');
    const toField = parseIdentifier();
    if (ts.peek().type === '[') parseBracketBlock();
    ts.expect('}');
    refs.push({ fromTable, fromField, toTable, toField, type: rel });
  }

  function parseTableGroup(): void {
    ts.expect('keyword');
    const name = parseIdentifier();
    let note = '';
    if (ts.peek().type === '[') {
      const block = parseBracketBlock();
      const s = settingsFromTokens(block);
      note = s.note;
    }
    ts.expect('{');
    const members: string[] = [];
    while (ts.peek().type !== '}' && !ts.isEof) {
      if (kw('Note')) {
        ts.consume();
        if (ts.peek().type === ':') { ts.consume(); note = parseString(); }
        else if (ts.peek().type === '{') { ts.consume(); note = parseString(); ts.expect('}'); }
        continue;
      }
      members.push(parseIdentifier());
    }
    ts.expect('}');
    tableGroups.push({ name, members, note });
  }

  function parseProject(): void {
    ts.expect('keyword');
    const name = parseIdentifier();
    ts.expect('{');
    let databaseType = '';
    let note = '';
    while (ts.peek().type !== '}' && !ts.isEof) {
      if (ts.peek().type === 'identifier' && ts.peek().value.toLowerCase() === 'database_type') {
        ts.consume();
        if (ts.peek().type === ':') { ts.consume(); databaseType = parseString(); }
        continue;
      }
      ts.consume();
    }
    ts.expect('}');
    projectInfo = { name, databaseType, note };
  }

  // ---- Main parse loop (case-insensitive keywords) ----
  while (!ts.isEof) {
    const t = ts.peek();
    if (t.type === 'keyword') {
      const kw = t.value.toLowerCase();
      switch (kw) {
        case 'table': {
          const h = parseTableHeader();
          parseTableBody(h.name, h.alias, h.headerColor);
          break;
        }
        case 'enum': parseEnum(); break;
        case 'ref': {
          ts.consume();
          if (ts.peek().type === ':') parseShortRef();
          else parseLongRef();
          break;
        }
        case 'tablegroup': parseTableGroup(); break;
        case 'project': parseProject(); break;
        default: ts.consume();
      }
    } else {
      ts.consume();
    }
  }

  // --- Resolve aliases ---
  function resolveAlias(n: string): string { return aliases[n] || n; }
  for (const r of refs) {
    r.fromTable = resolveAlias(r.fromTable);
    r.toTable = resolveAlias(r.toTable);
  }

  const enumLookup: Record<string, Enum> = {};
  for (const e of enums) enumLookup[e.name] = e;

  return { tables, refs, enums, aliases, tableGroups, projectInfo, enumLookup };
}

function computeLayout(tables: Table[], refs: Ref[]): Record<string, Position> {
  const factNames = tables.filter(t => t.name.startsWith('fact_')).map(t => t.name);
  const dimNames = tables.filter(t => !t.name.startsWith('fact_')).map(t => t.name);
  const positions: Record<string, Position> = {};

  if (factNames.length > 0) {
    const cx = 900, cy = 600;
    positions[factNames[0]] = { x: cx, y: cy };

    const connDims: string[] = [], unconDims: string[] = [];
    for (const d of dimNames) {
      const conn = refs.some(r => (r.fromTable === d || r.toTable === d) && (r.fromTable === factNames[0] || r.toTable === factNames[0]));
      (conn ? connDims : unconDims).push(d);
    }

    connDims.forEach((d, i) => {
      const a = (2 * Math.PI * i) / connDims.length - Math.PI / 2;
      positions[d] = { x: cx + 620 * Math.cos(a), y: cy + 620 * Math.sin(a) };
    });

    unconDims.forEach((d, i) => {
      const pr = refs.find(r => r.fromTable === d || r.toTable === d);
      if (pr) {
        const pn = pr.fromTable === d ? pr.toTable : pr.fromTable;
        const pp = positions[pn];
        if (pp) {
          const dx = pp.x - cx, dy = pp.y - cy, dist = Math.sqrt(dx * dx + dy * dy) || 1;
          positions[d] = { x: pp.x + (dx / dist) * 450, y: pp.y + (dy / dist) * 180 };
          return;
        }
      }
      positions[d] = { x: 100 + i * 440, y: cy + 700 };
    });

    for (let fi = 1; fi < factNames.length; fi++) {
      positions[factNames[fi]] = { x: cx + fi * 480, y: cy };
    }
  } else {
    const cols = Math.ceil(Math.sqrt(tables.length));
    tables.forEach((t, i) => {
      positions[t.name] = { x: 80 + (i % cols) * 440, y: 80 + Math.floor(i / cols) * 500 };
    });
  }
  return positions;
}

export function compileDBML(rawContent: string): CompiledDBML {
  try {
    const parsed = parseDBML(rawContent);
    const positions = computeLayout(parsed.tables, parsed.refs);
    return {
      tables: parsed.tables, refs: parsed.refs, enums: parsed.enums,
      enumLookup: parsed.enumLookup, tableGroups: parsed.tableGroups,
      positions, projectInfo: parsed.projectInfo,
      error: null,
    };
  } catch (err) {
    return {
      tables: [], refs: [], enums: [], enumLookup: {},
      tableGroups: [], positions: {},
      projectInfo: null, error: (err as Error).message,
    };
  }
}
