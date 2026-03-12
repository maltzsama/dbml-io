// ============================================================================
// DBML Parser — Full spec compliant
// ============================================================================

function parseDBML(rawContent) {
  const tables = [];
  const refs = [];
  const enums = [];
  const aliases = {};
  const tableGroups = [];
  let projectInfo = null;

  function stripComments(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
      if (src.slice(i, i + 3) === "'''") {
        const end = src.indexOf("'''", i + 3);
        if (end >= 0) { out += src.slice(i, end + 3); i = end + 3; continue; }
      }
      if (src[i] === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== "'") { if (src[j] === '\\') j++; j++; }
        out += src.slice(i, j + 1); i = j + 1; continue;
      }
      if (src[i] === '`') {
        const end = src.indexOf('`', i + 1);
        if (end >= 0) { out += src.slice(i, end + 1); i = end + 1; continue; }
      }
      if (src[i] === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end >= 0) { out += ' '; i = end + 2; continue; }
      }
      if (src[i] === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i);
        if (nl >= 0) { i = nl; continue; } else break;
      }
      out += src[i]; i++;
    }
    return out;
  }

  const content = stripComments(rawContent);

  function extractBlock(src, openPos) {
    let depth = 1, i = openPos;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      if (depth === 0) return { body: src.slice(openPos, i), end: i };
      i++;
    }
    return { body: src.slice(openPos), end: src.length };
  }

  function extractNote(optStr) {
    const tripleMatch = optStr.match(/note:\s*'''([\s\S]*?)'''/);
    if (tripleMatch) return tripleMatch[1].trim();
    const singleMatch = optStr.match(/note:\s*'([^']*)'/);
    if (singleMatch) return singleMatch[1];
    return '';
  }

  function extractTableNote(body) {
    const tripleMatch = body.match(/\bNote\s*:\s*'''([\s\S]*?)'''/);
    if (tripleMatch) return tripleMatch[1].trim();
    const blockTriple = body.match(/\bNote\s*\{\s*'''([\s\S]*?)'''\s*\}/);
    if (blockTriple) return blockTriple[1].trim();
    const singleMatch = body.match(/\bNote\s*:\s*'([^']*)'/);
    if (singleMatch) return singleMatch[1];
    const blockSingle = body.match(/\bNote\s*\{\s*'([^']*)'\s*\}/);
    if (blockSingle) return blockSingle[1];
    return '';
  }

  function parseColumnSettings(optStr) {
    const settings = {
      isPK: false, isFK: false, note: '', notNull: false, isNull: false,
      unique: false, increment: false, defaultVal: '', refs: [],
    };
    if (!optStr) return settings;

    settings.isPK = /\bpk\b/i.test(optStr) || /\bprimary\s+key\b/i.test(optStr);
    settings.notNull = /\bnot\s+null\b/i.test(optStr);
    if (!settings.notNull) settings.isNull = /\bnull\b/i.test(optStr);
    settings.unique = /\bunique\b/i.test(optStr);
    settings.increment = /\bincrement\b/i.test(optStr);
    settings.note = extractNote(optStr);

    const defMatch = optStr.match(/default:\s*(?:'([^']*)'|`([^`]*)`|(\S+?)(?:,|\]|$))/);
    if (defMatch) settings.defaultVal = defMatch[1] || defMatch[2] || defMatch[3] || '';

    const refPattern = /ref:\s*([<>\-]+)\s*([\w.]+)\.([\w]+)/g;
    let rm;
    while ((rm = refPattern.exec(optStr)) !== null) {
      const parts = rm[2].split('.');
      settings.refs.push({
        type: rm[1],
        table: parts.length >= 2 ? parts.join('.') : rm[2],
        field: rm[3],
      });
      settings.isFK = true;
    }
    return settings;
  }

  // --- Parse Tables ---
  const tablePattern = /\bTable\s+([\w.]+)(?:\s+as\s+(\w+))?\s*(?:\[([^\]]*)\])?\s*\{/g;
  let tm;
  while ((tm = tablePattern.exec(content)) !== null) {
    const rawName = tm[1];
    const alias = tm[2] || null;
    const tableSettings = tm[3] || '';
    const { body } = extractBlock(content, tm.index + tm[0].length);
    const fields = [];
    const tableNote = extractTableNote(body);

    const headerColorMatch = tableSettings.match(/headercolor:\s*(#?\w+)/i);
    const headerColor = headerColorMatch ? headerColorMatch[1] : '';

    const compositePKFields = [];
    const idxBlockMatch = body.match(/\bindexes\s*\{/);
    if (idxBlockMatch) {
      const idxStart = body.indexOf('{', idxBlockMatch.index + 7) + 1;
      const idxBlock = extractBlock(body, idxStart);
      const pkLine = idxBlock.body.match(/\(([^)]+)\)\s*\[([^\]]*)\]/g);
      if (pkLine) {
        for (const pl of pkLine) {
          const m2 = pl.match(/\(([^)]+)\)\s*\[([^\]]*)\]/);
          if (m2 && /\bpk\b/i.test(m2[2])) {
            compositePKFields.push(...m2[1].split(',').map(f => f.trim().replace(/`/g, '')));
          }
        }
      }
    }

    const fieldLines = body.split('\n');
    let inIndexes = false, inRecords = false, inChecks = false, braceCount = 0;

    for (const fl of fieldLines) {
      const trimmed = fl.trim();
      if (!trimmed) continue;
      if (/^\bindexes\s*\{/.test(trimmed)) { inIndexes = true; braceCount = 1; continue; }
      if (/^\brecords\b/.test(trimmed)) { inRecords = true; braceCount = 0; }
      if (/^\bchecks\s*\{/.test(trimmed)) { inChecks = true; braceCount = 1; continue; }
      if (inIndexes || inRecords || inChecks) {
        for (const ch of trimmed) { if (ch === '{') braceCount++; if (ch === '}') braceCount--; }
        if (braceCount <= 0) { inIndexes = false; inRecords = false; inChecks = false; }
        continue;
      }
      if (/^\bNote\b/i.test(trimmed) || trimmed.startsWith('~') || trimmed === '{' || trimmed === '}' || trimmed.startsWith('(')) continue;

      const fieldNameMatch = trimmed.match(/^(?:"([^"]+)"|(\w+))\s+([\w"(),.]+(?:\s+[\w"(),.]+)*)/);
      if (fieldNameMatch) {
        const fieldName = fieldNameMatch[1] || fieldNameMatch[2];
        const fieldType = (fieldNameMatch[3] || '').trim().replace(/"/g, '');

        let optStr = '';
        const afterType = trimmed.substring(fieldNameMatch[0].length).trim();
        if (afterType.startsWith('[')) {
          let depth = 0, inQuote = false, j = 0;
          for (j = 0; j < afterType.length; j++) {
            const ch = afterType[j];
            if (ch === "'" && !inQuote) { inQuote = true; continue; }
            if (ch === "'" && inQuote) { inQuote = false; continue; }
            if (inQuote) continue;
            if (ch === '[') depth++;
            if (ch === ']') { depth--; if (depth === 0) break; }
          }
          optStr = afterType.substring(1, j);
        }

        const settings = parseColumnSettings(optStr);
        settings.isPK = settings.isPK || compositePKFields.includes(fieldName);

        for (const r of settings.refs) {
          refs.push({ fromTable: rawName, fromField: fieldName, toTable: r.table, toField: r.field, type: r.type });
        }

        fields.push({
          name: fieldName, type: fieldType, isPK: settings.isPK, isFK: settings.isFK,
          note: settings.note, notNull: settings.notNull, unique: settings.unique,
          increment: settings.increment, defaultVal: settings.defaultVal,
        });
      }
    }

    tables.push({ name: rawName, fields, note: tableNote, headerColor });
    if (alias) aliases[alias] = rawName;
  }

  // --- Parse Enums ---
  const enumPattern = /\benum\s+([\w.]+)\s*\{/g;
  let em;
  while ((em = enumPattern.exec(content)) !== null) {
    const { body } = extractBlock(content, em.index + em[0].length);
    const values = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t === '{' || t === '}') continue;
      const vm = t.match(/^(?:"([^"]+)"|(\w+))\s*(?:\[([^\]]*)\])?/);
      if (vm) values.push({ value: vm[1] || vm[2], note: vm[3] ? extractNote(vm[3]) : '' });
    }
    enums.push({ name: em[1], values });
  }

  // --- Parse Explicit Refs (short form) ---
  const shortRefPattern = /\bRef\s*(?:\w+\s*)?:\s*([\w.]+)\.([\w.]+)(?:\(([\w\s,]+)\))?\s*([<>\-]+)\s*([\w.]+)\.([\w.]+)(?:\(([\w\s,]+)\))?\s*(?:\[([^\]]*)\])?/g;
  let sr;
  while ((sr = shortRefPattern.exec(content)) !== null) {
    const fromComposite = sr[3] ? sr[3].split(',').map(s => s.trim()) : null;
    const relType = sr[4];
    const toComposite = sr[7] ? sr[7].split(',').map(s => s.trim()) : null;

    if (fromComposite) {
      const fromTable = sr[1] + '.' + sr[2];
      if (toComposite && fromComposite.length === toComposite.length) {
        const toTable = sr[5] + '.' + sr[6];
        for (let i = 0; i < fromComposite.length; i++) {
          refs.push({ fromTable, fromField: fromComposite[i], toTable, toField: toComposite[i], type: relType });
        }
      }
      continue;
    }

    refs.push({ fromTable: sr[1], fromField: sr[2], toTable: sr[5], toField: sr[6], type: relType });
  }

  // --- Parse Explicit Refs (long form) ---
  const longRefPattern = /\bRef\s+(\w+)?\s*\{/g;
  let lr;
  while ((lr = longRefPattern.exec(content)) !== null) {
    const { body } = extractBlock(content, lr.index + lr[0].length);
    const innerRef = body.match(/([\w.]+)\.([\w]+)\s*([<>\-]+)\s*([\w.]+)\.([\w]+)\s*(?:\[([^\]]*)\])?/);
    if (innerRef) {
      refs.push({ fromTable: innerRef[1], fromField: innerRef[2], toTable: innerRef[4], toField: innerRef[5], type: innerRef[3] });
    }
  }

  // --- Parse TableGroups ---
  const tgPattern = /\bTableGroup\s+([\w.]+)\s*(?:\[([^\]]*)\])?\s*\{/g;
  let tg;
  while ((tg = tgPattern.exec(content)) !== null) {
    const { body } = extractBlock(content, tg.index + tg[0].length);
    const settings = tg[2] || '';
    const note = extractNote(settings) || extractTableNote(body);
    const members = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Note') && l !== '{' && l !== '}');
    tableGroups.push({ name: tg[1], members, note });
  }

  // --- Parse Project ---
  const projMatch = content.match(/\bProject\s+([\w.]+)\s*\{/);
  if (projMatch) {
    const { body } = extractBlock(content, projMatch.index + projMatch[0].length);
    const dbType = body.match(/database_type:\s*'([^']*)'/);
    projectInfo = { name: projMatch[1], databaseType: dbType ? dbType[1] : '', note: extractTableNote(body) };
  }

  // --- Resolve aliases ---
  function resolveAlias(n) { return aliases[n] || n; }
  for (const r of refs) { r.fromTable = resolveAlias(r.fromTable); r.toTable = resolveAlias(r.toTable); }

  const enumLookup = {};
  for (const e of enums) enumLookup[e.name] = e;

  return { tables, refs, enums, aliases, tableGroups, projectInfo, enumLookup };
}

function computeLayout(tables, refs) {
  const factNames = tables.filter(t => t.name.startsWith('fact_')).map(t => t.name);
  const dimNames = tables.filter(t => !t.name.startsWith('fact_')).map(t => t.name);
  const positions = {};

  if (factNames.length > 0) {
    const cx = 900, cy = 600;
    positions[factNames[0]] = { x: cx, y: cy };

    const connDims = [], unconDims = [];
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

export function compileDBML(rawContent) {
  try {
    const parsed = parseDBML(rawContent);
    const positions = computeLayout(parsed.tables, parsed.refs);
    return {
      tables: parsed.tables, refs: parsed.refs, enums: parsed.enums,
      enumLookup: parsed.enumLookup, positions, projectInfo: parsed.projectInfo,
      error: null,
    };
  } catch (err) {
    return {
      tables: [], refs: [], enums: [], enumLookup: {}, positions: {},
      projectInfo: null, error: err.message,
    };
  }
}
