// npm run zip — release/game.zip from dist/ with index.html at the archive root (itch.io).
// Minimal ZIP writer (deflate via node:zlib), no dependencies.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk('dist');
if (!files.some((f) => relative('dist', f) === 'index.html')) throw new Error('dist/index.html missing — run npm run build');
const local: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(relative('dist', f).split(sep).join('/'));
  const data = readFileSync(f);
  const comp = deflateRawSync(data, { level: 9 });
  const useComp = comp.length < data.length;
  const body = useComp ? comp : data;
  const crc = crc32(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6); // UTF-8 names
  h.writeUInt16LE(useComp ? 8 : 0, 8);
  h.writeUInt32LE(0, 10); // time/date
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(body.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26);
  h.writeUInt16LE(0, 28);
  local.push(h, name, body);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(useComp ? 8 : 0, 10);
  c.writeUInt32LE(0, 12);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(body.length, 20);
  c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + body.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
mkdirSync('release', { recursive: true });
const zip = Buffer.concat([...local, cd, end]);
writeFileSync('release/game.zip', zip);
console.log(`release/game.zip  ${files.length} files  ${(zip.length / 1024).toFixed(0)} KB`);
