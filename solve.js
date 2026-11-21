// Fast drop-in for make.fun's csv-reader 1.0.0.
// Same answers on every input, reached by bulk scanning instead of one
// character at a time: each field is cut with indexOf to the next
// delimiter and copied in one slice. Every scan is bounded by the field
// it serves — no indexOf ever runs past a field's end — so a rare
// character (a lone CR) cannot cost a scan of the rest of the text.
// The broken-row policy is csv-reader's own, reimplemented exactly:
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, an empty line is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a quoted field runs to the next quote that is not doubled, "" is
//     one quote, CRLF or a lone CR inside it reads as LF; what follows
//     the closing quote up to the next comma or line break is appended
//     as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is literal; fields stay strings;
//   - columns is the first record when header is true, else null; rows
//     are the records after it, padded (short_row) or cut (long_row)
//     to the first record's width; errors are {code, line, row} in the
//     order met, line the 1-based line the record starts on, row its
//     index in rows (null for the header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many
  // characters the unquoted scan kept (only the quote_junk check reads it).
  let fv = '';
  let fe = END;
  let fa = 0;

  // Reads an unquoted field from pos, starting from `start` ('' normally,
  // the opening quote for an unterminated field, the quoted value for
  // the junk after a closing quote). Sets fv/fe/fa.
  function readUnquoted(start) {
    let value = start;
    let added = 0;
    for (;;) {
      let c = text.indexOf(',', pos);
      if (c === -1) c = n;
      let l = text.indexOf('\n', pos);
      if (l === -1) l = n;
      const m = c < l ? c : l;
      if (m >= n) {
        if (pos < n) {
          const seg = text.slice(pos, n);
          if (seg.indexOf('\r') === -1) {
            value += seg;
            added += seg.length;
          } else {
            for (let i = 0; i < seg.length; i++) {
              const ch = seg.charCodeAt(i);
              if (ch === 13) {
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              } else {
                value += seg[i];
                added += 1;
              }
            }
          }
        }
        pos = n;
        fv = value;
        fe = END;
        fa = added;
        return;
      }
      const seg = text.slice(pos, m);
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        // No CR in the segment: the whole slice is the field's text.
        value += seg;
        added += seg.length;
      } else {
        // Lone CRs inside the segment are dropped (stray_cr each). A CR
        // at the very end of the segment, right before the LF that ends
        // the field, is the CRLF half, not a stray CR.
        const cut =
          text.charCodeAt(m) === 10 && seg.charCodeAt(seg.length - 1) === 13
            ? seg.length - 1
            : seg.length;
        let from = 0;
        for (let i = cr; i < cut; i++) {
          if (seg.charCodeAt(i) === 13) {
            value += seg.slice(from, i);
            added += i - from;
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            from = i + 1;
          }
        }
        value += seg.slice(from, cut);
        added += cut - from;
      }
      const ch = text.charCodeAt(m);
      if (ch === 44) {
        pos = m + 1;
        fv = value;
        fe = COMMA;
        fa = added;
        return;
      }
      // ch is LF: a CR right before it was already handled above as CRLF.
      pos = m + 1;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      fa = added;
      return;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fv/fe/fa.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // A quote that never closes is read again as unquoted: if there is
    // no quote at all after the opening one, skip the quoted scan.
    if (text.indexOf('"', open + 1) === -1) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    pos += 1;
    let value = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      // q >= 0 here (a quote exists after the opening one), unless the
      // only quotes left were doubled pairs already consumed.
      if (q === -1) {
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const seg = text.slice(pos, q);
      const cr = seg.indexOf('\r');
      const lf = seg.indexOf('\n');
      if (cr === -1 && lf === -1) {
        value += seg;
      } else if (cr === -1) {
        // Newlines only: they stay as they are, each one a new line.
        value += seg;
        let i = lf;
        while (i !== -1) {
          line += 1;
          i = seg.indexOf('\n', i + 1);
        }
      } else {
        // CRs present: each CRLF or lone CR becomes one LF, one line.
        let from = 0;
        for (let i = 0; i < seg.length; i++) {
          const ch = seg.charCodeAt(i);
          if (ch === 13 || ch === 10) {
            value += seg.slice(from, i);
            value += '\n';
            line += 1;
            if (ch === 13 && seg.charCodeAt(i + 1) === 10) i += 1;
            from = i + 1;
          }
        }
        value += seg.slice(from);
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      break; // closed
    }
    if (pos >= n) {
      fv = value;
      fe = END;
      fa = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fv = value;
      fe = COMMA;
      fa = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      fa = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      fa = 0;
      return;
    }
    // What follows the closing quote is appended as it stands.
    readUnquoted(value);
    if (fa > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  for (;;) {
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

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fv);
    } while (fe === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
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
  return { columns: header ? columns ?? [] : null, rows, errors };
}
