// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference CSV reader).
// Same answers for every input, much faster: fields are taken as slices
// between delimiters found by the engine (regex / indexOf) instead of one
// character at a time, and quoted fields are taken as slices between quotes.
//
// Semantics (exactly csv-reader 1.0.0's):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//   what follows its closing quote up to the next comma or line break is
//   appended as it stands (quote_junk, when the field ends); a quote that
//   never closes is a literal character and the text after it is read again
//   as unquoted (unterminated_quote).
// - A quote inside an unquoted field is a literal character.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows are the
//   records after it, each padded (short_row, with fields: its field count)
//   or cut (long_row, with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on, row its record's index in rows, null for the
//   header.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// The next delimiter of an unquoted field: a comma, a CR or an LF.
const DELIM = /[,\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Read by the field readers below for errors.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `prefix` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field,
  // how it ended, and how many characters were kept after the prefix.
  function readUnquoted(prefix) {
    let parts = null;
    let added = 0;
    let start = pos;
    while (pos < n) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        const tail = pos < n ? text.slice(pos) : '';
        pos = n;
        added += tail.length;
        if (parts === null) return { value: prefix + tail, ended: END, added };
        parts.push(tail);
        return { value: prefix + parts.join(''), ended: END, added };
      }
      const i = m.index;
      const ch = m[0];
      if (ch === ',') {
        const seg = text.slice(pos, i);
        added += seg.length;
        pos = i + 1;
        if (parts === null) return { value: prefix + seg, ended: COMMA, added };
        parts.push(seg);
        return { value: prefix + parts.join(''), ended: COMMA, added };
      }
      if (ch === '\n') {
        const seg = text.slice(pos, i);
        added += seg.length;
        pos = i + 1;
        line += 1;
        if (parts === null) return { value: prefix + seg, ended: LINE_BREAK, added };
        parts.push(seg);
        return { value: prefix + parts.join(''), ended: LINE_BREAK, added };
      }
      // ch === '\r'
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        const seg = text.slice(pos, i);
        added += seg.length;
        pos = i + 2;
        line += 1;
        if (parts === null) return { value: prefix + seg, ended: LINE_BREAK, added };
        parts.push(seg);
        return { value: prefix + parts.join(''), ended: LINE_BREAK, added };
      }
      // A lone CR outside quotes: dropped (stray_cr), the field goes on.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (i > pos) {
        const seg = text.slice(pos, i);
        added += seg.length;
        if (parts === null) parts = [seg];
        else parts.push(seg);
      }
      pos = i + 1;
      start = pos;
    }
    void start;
    return { value: parts === null ? prefix : prefix + parts.join(''), ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    while (true) {
      const qi = text.indexOf('"', pos);
      if (qi === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      let seg = text.slice(pos, qi);
      if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
        // CRLF and a lone CR inside quotes are each one LF.
        let converted = '';
        let nl = 0;
        for (let k = 0; k < seg.length; k++) {
          const c = seg.charCodeAt(k);
          if (c === 13) {
            converted += '\n';
            nl += 1;
            if (k + 1 < seg.length && seg.charCodeAt(k + 1) === 10) k += 1;
          } else {
            converted += seg[k];
            if (c === 10) nl += 1;
          }
        }
        seg = converted;
        line += nl;
      }
      if (qi + 1 < n && text.charCodeAt(qi + 1) === 34) {
        // A doubled quote inside: one quote, the field goes on.
        value += seg;
        value += '"';
        pos = qi + 2;
        continue;
      }
      // Closed.
      value += seg;
      pos = qi + 1;
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return junk;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    // Fast path: a whole record on one line with no quotes and no stray CR
    // (only a CRLF's CR, if any). Then the record is the line, split on ','.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    const qi0 = text.indexOf('"', pos);
    const ri0 = text.indexOf('\r', pos);
    if ((qi0 === -1 || qi0 >= lineEnd) && (ri0 === -1 || (nl !== -1 && ri0 === lineEnd - 1))) {
      let segEnd = lineEnd;
      if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
      const parts = text.slice(pos, segEnd).split(',');
      for (let k = 0; k < parts.length; k++) fields.push(parts[k]);
      pos = nl === -1 ? n : nl + 1;
      if (nl !== -1) line += 1;
    } else {
      let field;
      do {
        quoted = text.charCodeAt(pos) === 34;
        field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field.value);
      } while (field.ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
