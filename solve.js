// csv-reader-speed: a fast drop-in for csv-reader 1.0.0.
//
// The task is to return exactly what make.fun's csv-reader 1.0.0 returns for
// {text, header}: {columns, rows, errors}, but faster. The reference reads one
// character at a time and builds every field up a character at a time; this
// parser instead scans each field once for its end and takes the field with a
// single slice, so the hot loop never allocates. Quoted fields are scanned the
// same way, and only a field that actually holds a doubled quote or a CR pays
// for assembling its value from parts. The broken-row policy below is
// csv-reader's own, kept line for line in behaviour:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, each CRLF or lone CR inside it is
//     read as LF; what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row) or cut (long_row)
//     to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts
//     on, row its record's index in rows (null for the header).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/**
 * Reads an unquoted field starting at `start`, with `value` already in it.
 * Only the slow road leads here: a stray CR, a quote that never closed, or
 * junk after a closing quote. Returns {value, ended, added, pos, line};
 * `added` counts the characters this read kept (not the `value` it started
 * with, and not the stray CRs it dropped).
 */
function readUnquotedSlow(text, n, start, value, recordLine, recordRow, errors, line) {
  let pos = start;
  let added = 0;
  let seg = start;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 44 || c === 10 || c === 13) {
      if (pos > seg) {
        value += text.slice(seg, pos);
        added += pos - seg;
      }
      if (c === 44) return { value, ended: COMMA, added, pos: pos + 1, line };
      if (c === 10) return { value, ended: LINE_BREAK, added, pos: pos + 1, line: line + 1 };
      if (text.charCodeAt(pos + 1) === 10) {
        return { value, ended: LINE_BREAK, added, pos: pos + 2, line: line + 1 };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos += 1;
      seg = pos;
      continue;
    }
    pos += 1;
  }
  if (pos > seg) {
    value += text.slice(seg, pos);
    added += pos - seg;
  }
  return { value, ended: END, added, pos, line };
}

/** csv-reader 1.0.0's answer for one case's input, read fast. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;

    while (true) {
      let value;
      let ended;
      if (text.charCodeAt(pos) === 34) {
        // A quoted field: scan to its closing quote without building anything.
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let i = pos + 1;
        let seg = i;
        let parts = null;
        let closed = false;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              if (parts === null) parts = [];
              if (i > seg) parts.push(text.slice(seg, i));
              parts.push('"');
              i += 2;
              seg = i;
              continue;
            }
            closed = true;
            break;
          }
          if (c === 13) {
            // CRLF and a lone CR inside quotes are each one LF.
            if (parts === null) parts = [];
            if (i > seg) parts.push(text.slice(seg, i));
            parts.push('\n');
            line += 1;
            i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
            seg = i;
            continue;
          }
          if (c === 10) {
            line += 1;
            i += 1;
            continue;
          }
          i += 1;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquotedSlow(text, n, open + 1, '"', recordLine, recordRow, errors, openLine);
          value = r.value;
          ended = r.ended;
          pos = r.pos;
          line = r.line;
        } else {
          if (parts === null) {
            value = text.slice(open + 1, i);
          } else {
            if (i > seg) parts.push(text.slice(seg, i));
            value = parts.join('');
          }
          pos = i + 1;
          if (pos >= n) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              ended = COMMA;
              pos += 1;
            } else if (c === 10) {
              ended = LINE_BREAK;
              pos += 1;
              line += 1;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              ended = LINE_BREAK;
              pos += 2;
              line += 1;
            } else {
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break.
              const r = readUnquotedSlow(text, n, pos, value, recordLine, recordRow, errors, line);
              if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = r.value;
              ended = r.ended;
              pos = r.pos;
              line = r.line;
            }
          }
        }
      } else {
        // An unquoted field: scan to its end, then take it in one slice.
        lastQuoted = false;
        let i = pos;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44 || c === 10 || c === 13) break;
          i += 1;
        }
        if (i >= n) {
          value = text.slice(pos);
          ended = END;
          pos = n;
        } else {
          const c = text.charCodeAt(i);
          if (c === 44) {
            value = text.slice(pos, i);
            ended = COMMA;
            pos = i + 1;
          } else if (c === 10) {
            value = text.slice(pos, i);
            ended = LINE_BREAK;
            pos = i + 1;
            line += 1;
          } else if (text.charCodeAt(i + 1) === 10) {
            value = text.slice(pos, i);
            ended = LINE_BREAK;
            pos = i + 2;
            line += 1;
          } else {
            // A lone CR is dropped (stray_cr); the field goes on.
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            const r = readUnquotedSlow(text, n, i + 1, text.slice(pos, i), recordLine, recordRow, errors, line);
            value = r.value;
            ended = r.ended;
            pos = r.pos;
            line = r.line;
          }
        }
      }
      fields.push(value);
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

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
