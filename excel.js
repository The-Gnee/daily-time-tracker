// Minimal uncompressed Open XML workbook writer. All user text is stored as text.
function excelWorkbook(sheets) {
  const encode = text => new TextEncoder().encode(text);
  const escape = text => String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const column = index => {
    let result = '';
    for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
    return result;
  };
  const files = [];
  const add = (name, text) => files.push({name:encode(name), bytes:encode(text)});
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  add('[Content_Types].xml', xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
  add('_rels/.rels', xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml', xml + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((sheet, i) => '<sheet name="' + escape(sheet.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  add('xl/styles.xml', xml + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17483D"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((sheet, i) => {
    const last = column(sheet.rows[0].length - 1) + sheet.rows.length;
    add('xl/worksheets/sheet' + (i + 1) + '.xml', xml + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<dimension ref="A1:' + last + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + '<cols>' + sheet.rows[0].map((_, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (sheet.widths?.[c] ?? 22) + '" customWidth="1"/>').join('') + '</cols><sheetData>'
      + sheet.rows.map((row, r) => '<row r="' + (r + 1) + '"' + (r === 0 ? ' ht="26" customHeight="1"' : '') + '>' + row.map((value, c) => {
        const ref = column(c) + (r + 1);
        const style = r === 0 ? 1 : sheet.currency?.includes(c) ? 2 : 0;
        if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + ref + '" s="' + style + '"><v>' + value + '</v></c>';
        return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + escape(value ?? '') + '</t></is></c>';
      }).join('') + '</row>').join('') + '</sheetData><autoFilter ref="A1:' + last + '"/></worksheet>');
  });
  // ZIP headers use stored entries and CRC32, so exports work offline without a library.
  const crcTable = Array.from({length:256}, (_, n) => {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xEDB88320 ^ c >>> 1 : c >>> 1;
    return c >>> 0;
  });
  const chunks = [], directory = [];
  let offset = 0;
  for (const file of files) {
    let crc = 0xFFFFFFFF;
    for (const byte of file.bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true);
    h.setUint32(14, crc, true); h.setUint32(18, file.bytes.length, true); h.setUint32(22, file.bytes.length, true); h.setUint16(26, file.name.length, true);
    const central = new Uint8Array(46), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint32(16, crc, true); c.setUint32(20, file.bytes.length, true); c.setUint32(24, file.bytes.length, true); c.setUint16(28, file.name.length, true); c.setUint32(42, offset, true);
    chunks.push(header, file.name, file.bytes); directory.push(central, file.name);
    offset += header.length + file.name.length + file.bytes.length;
  }
  const size = directory.reduce((sum, bytes) => sum + bytes.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054B50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const output = new Uint8Array(offset + size + end.length);
  let cursor = 0;
  for (const bytes of [...chunks, ...directory, end]) { output.set(bytes, cursor); cursor += bytes.length; }
  return output;
}

function jobExportSheets(data, receipts, job) {
  const jobs = job ? [job] : data.jobs;
  const sessions = data.entries.filter(entry => entry.end !== null && jobs.includes(entry.job))
    .sort((a, b) => a.start - b.start);
  const purchases = receipts.filter(receipt => !receipt.deletedAt && jobs.includes(receipt.job))
    .sort((a, b) => a.date.localeCompare(b.date));
  const daily = new Map();
  for (const entry of sessions) {
    const key = JSON.stringify([entry.job, entry.day]);
    if (!daily.has(key)) daily.set(key, {job:entry.job, day:entry.day, times:[0,0]});
    daily.get(key).times[entry.worker] += entry.end - entry.start;
  }
  const round = dollars => Math.round((dollars + Number.EPSILON) * 100) / 100;
  const minutes = ms => Math.floor(ms / 60000);
  const labour = times => times.reduce((sum, ms, i) => sum + minutes(ms) * workers[i].rate / 6000, 0);
  return [
    {name:'Job Summary', currency:[2,3,4], widths:[32,18,22,22,24], rows:[
      ['Job','Status','Labour','Receipts incl. tax','Labour + receipts'],
      ...jobs.map(name => {
        const work = [...daily.values()].filter(row => row.job === name).reduce((sum, row) => sum + labour(row.times), 0);
        const costs = purchases.filter(receipt => receipt.job === name).reduce((sum, receipt) => sum + receipt.total, 0) / 100;
        return [name, data.archived.includes(name) ? 'Archived' : 'Current', round(work), costs, round(work + costs)];
      })]},
    {name:'Daily Labour', currency:[4,5,6], widths:[32,16,20,20,22,22,22], rows:[
      ['Job','Workday','Graham minutes','Hayden minutes','Graham labour','Hayden labour','Labour total'],
      ...[...daily.values()].sort((a,b) => a.day.localeCompare(b.day) || a.job.localeCompare(b.job)).map(row => [row.job,row.day,
        ...row.times.map(minutes), ...row.times.map((ms, i) => round(minutes(ms) * workers[i].rate / 6000)), round(labour(row.times))])]},
    {name:'Time Sessions', widths:[32,16,16,24,24,20,48], rows:[
      ['Job','Workday','Worker','Actual start (local)','Actual stop (local)','Elapsed seconds','Correction notes'],
      ...sessions.map(entry => [entry.job,entry.day,workers[entry.worker].name,localTime(entry.start),localTime(entry.end),(entry.end-entry.start)/1000,entry.notes.join(' | ')])]},
    {name:'Receipts', currency:[4,5,6,7], widths:[32,16,30,24,18,18,18,20,18,48,24], rows:[
      ['Job','Receipt date','Supplier','Category','Subtotal','GST / HST','PST','Total incl. tax','Card last four','Notes','Photo stored'],
      ...purchases.map(receipt => [receipt.job,receipt.date,receipt.vendor,receipt.category,
        ...[receipt.subtotal,receipt.gst,receipt.pst].map(value => value === null ? '' : value / 100),receipt.total / 100,
        receipt.card,receipt.notes,receipt.photo ? 'In JSON backup' : 'No photo'])]}
  ];
}
