import * as fs from 'node:fs';

/** One face of an installed font file (a `.ttc` collection holds several). */
export interface FontFace {
  file: string;
  postscriptName: string;
  /** Inside a `.ttc` collection: the face is picked by `postscriptName`. */
  collection: boolean;
  /** Typographic family ("Segoe UI" for Segoe UI Light, Bold, ...). */
  family: string;
  /** 100–900. */
  weight: number;
  italic: boolean;
}

/**
 * Reads the faces of a TrueType / OpenType font or collection, touching only the
 * table directory and the `name` and `OS/2` tables. Unreadable files give `[]`.
 */
export function readFontFaces(file: string): FontFace[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const read = (offset: number, length: number): Buffer => {
      const buffer = Buffer.alloc(length);
      const bytes = fs.readSync(fd!, buffer, 0, length, offset);
      if (bytes < length) throw new Error('truncated font');
      return buffer;
    };
    const header = read(0, 12);
    const collection = header.toString('latin1', 0, 4) === 'ttcf';
    const offsets = collection
      ? Array.from({ length: Math.min(header.readUInt32BE(8), 64) }, (_, i) =>
          read(12 + i * 4, 4).readUInt32BE(0),
        )
      : [0];
    const faces: FontFace[] = [];
    for (const offset of offsets) {
      const face = readFace(read, offset, file);
      if (face) faces.push({ ...face, collection });
    }
    return faces;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readFace(
  read: (offset: number, length: number) => Buffer,
  offset: number,
  file: string,
): Omit<FontFace, 'collection'> | undefined {
  const numTables = read(offset + 4, 2).readUInt16BE(0);
  const directory = read(offset + 12, numTables * 16);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const record = i * 16;
    tables.set(directory.toString('latin1', record, record + 4), {
      offset: directory.readUInt32BE(record + 8),
      length: directory.readUInt32BE(record + 12),
    });
  }

  const nameTable = tables.get('name');
  if (!nameTable) return undefined;
  const names = readNames(read(nameTable.offset, nameTable.length));
  const family = names.get(16) ?? names.get(1);
  const subfamily = names.get(17) ?? names.get(2) ?? '';
  const postscriptName = names.get(6);
  if (!family || !postscriptName) return undefined;

  let weight = /bold|black|heavy/i.test(subfamily) ? 700 : 400;
  let italic = /italic|oblique/i.test(subfamily);
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 64) {
    const table = read(os2.offset, 64);
    weight = table.readUInt16BE(4) || weight;
    italic ||= (table.readUInt16BE(62) & 1) !== 0;
  }
  return { file, postscriptName, family, weight, italic };
}

/** Name IDs to strings, preferring Windows Unicode English, then Mac Roman. */
function readNames(table: Buffer): Map<number, string> {
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const names = new Map<number, { text: string; rank: number }>();
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    if (record + 12 > table.length) break;
    const platform = table.readUInt16BE(record);
    const encoding = table.readUInt16BE(record + 2);
    const language = table.readUInt16BE(record + 4);
    const nameId = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const start = storage + table.readUInt16BE(record + 10);
    if (![1, 2, 4, 6, 16, 17].includes(nameId) || start + length > table.length) continue;

    let text: string;
    let rank: number;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      text = decodeUtf16be(table.subarray(start, start + length));
      rank = language === 0x409 ? 3 : 2;
    } else if (platform === 0) {
      text = decodeUtf16be(table.subarray(start, start + length));
      rank = 1;
    } else if (platform === 1 && encoding === 0) {
      text = table.toString('latin1', start, start + length);
      rank = language === 0 ? 1 : 0;
    } else {
      continue;
    }
    const current = names.get(nameId);
    if (!current || rank > current.rank) names.set(nameId, { text: text.trim(), rank });
  }
  return new Map([...names].map(([id, { text }]) => [id, text]));
}

function decodeUtf16be(bytes: Buffer): string {
  const swapped = Buffer.from(bytes.subarray(0, bytes.length & ~1));
  swapped.swap16();
  return swapped.toString('utf16le');
}
