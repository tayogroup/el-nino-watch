// Community uploads are public. Phones write the place a photo or video was taken (GPS), the device and
// often the owner's name into the file itself, so every upload is cleaned before it is stored.
// Only metadata is removed; the pixels and frames are copied unchanged, so no image or video library is needed.
// A file that cannot be read safely is refused rather than stored with its metadata.

export class MediaMetadataError extends Error {}

const bad = message => { throw new MediaMetadataError(message); };

export function stripMetadata(bytes, type) {
  const input = Buffer.from(bytes);
  if (type === 'image/jpeg') return stripJpeg(input);
  if (type === 'image/png') return stripPng(input);
  if (type === 'image/webp') return stripWebp(input);
  if (type === 'image/gif') return stripGif(input);
  if (type === 'video/mp4') return stripMp4(input);
  // WebM (Matroska) from phones does not carry a location; it is stored as uploaded.
  if (type === 'video/webm') return input;
  bad('Unsupported media type.');
}

// JPEG: drop APP1 (Exif, XMP), APP13 (IPTC) and comments. Other APP segments other than
// JFIF, ICC colour profiles and Adobe colour data are dropped too. The Exif orientation is
// kept in a minimal new Exif segment, so portrait photos still display upright.
function stripJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) bad('Not a JPEG image.');
  const parts = [b.subarray(0, 2)];
  let orientation = 1, at = 2;
  while (at < b.length) {
    if (b[at] !== 0xff) bad('Unreadable JPEG structure.');
    let marker = b[at + 1];
    while (marker === 0xff) { at += 1; marker = b[at + 1]; }
    if (marker === undefined) bad('Unreadable JPEG structure.');
    if (marker === 0xd9) { parts.push(b.subarray(at, at + 2)); at += 2; break; }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push(b.subarray(at, at + 2)); at += 2; continue; }
    if (at + 4 > b.length) bad('Unreadable JPEG structure.');
    const length = b.readUInt16BE(at + 2), end = at + 2 + length;
    if (length < 2 || end > b.length) bad('Unreadable JPEG structure.');
    const segment = b.subarray(at, end), data = b.subarray(at + 4, end);
    if (marker === 0xda) { parts.push(b.subarray(at)); at = b.length; break; }
    if (marker === 0xe1) {
      if (data.subarray(0, 6).toString('latin1') === 'Exif\0\0') orientation = exifOrientation(data.subarray(6)) || orientation;
    } else if (marker === 0xe0 && /^(JFIF|JFXX)\0/.test(data.subarray(0, 5).toString('latin1'))) parts.push(segment);
    else if (marker === 0xe2 && data.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0') parts.push(segment);
    else if (marker === 0xee && data.subarray(0, 5).toString('latin1') === 'Adobe') parts.push(segment);
    else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(segment);
    at = end;
  }
  if (orientation !== 1) parts.splice(1, 0, orientationSegment(orientation));
  return Buffer.concat(parts);
}

function exifOrientation(tiff) {
  try {
    const little = tiff.subarray(0, 2).toString('latin1') === 'II';
    if (!little && tiff.subarray(0, 2).toString('latin1') !== 'MM') return null;
    const u16 = at => little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at);
    const u32 = at => little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at);
    const ifd = u32(4), count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) { const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : null; }
    }
  } catch { return null; }
  return null;
}

function orientationSegment(orientation) {
  // "Exif\0\0" + big-endian TIFF header + one IFD entry (Orientation, SHORT, 1) + no next IFD.
  const tiff = Buffer.from([0x4d,0x4d,0,42, 0,0,0,8, 0,1, 0x01,0x12, 0,3, 0,0,0,1, 0,orientation,0,0, 0,0,0,0]);
  const data = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]); head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

// PNG: drop text chunks (which carry XMP and comments), eXIf and the edit time. Chunk CRCs are unchanged
// because kept chunks are copied whole.
function stripPng(b) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (b.length < 8 || !b.subarray(0, 8).equals(signature)) bad('Not a PNG image.');
  const drop = new Set(['tEXt','zTXt','iTXt','eXIf','tIME']), parts = [signature];
  let at = 8, ended = false;
  while (at < b.length) {
    if (at + 12 > b.length) bad('Unreadable PNG structure.');
    const length = b.readUInt32BE(at), type = b.subarray(at + 4, at + 8).toString('latin1'), end = at + 12 + length;
    if (end > b.length) bad('Unreadable PNG structure.');
    if (!drop.has(type)) parts.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!ended) bad('Unreadable PNG structure.');
  return Buffer.concat(parts);
}

// WebP: drop the EXIF and XMP chunks and clear their flags in the VP8X header.
function stripWebp(b) {
  if (b.length < 12 || b.subarray(0, 4).toString('latin1') !== 'RIFF' || b.subarray(8, 12).toString('latin1') !== 'WEBP') bad('Not a WebP image.');
  const riffEnd = Math.min(b.length, 8 + b.readUInt32LE(4)), chunks = [];
  let at = 12;
  while (at + 8 <= riffEnd) {
    const fourcc = b.subarray(at, at + 4).toString('latin1'), size = b.readUInt32LE(at + 4), end = at + 8 + size + (size % 2);
    if (at + 8 + size > riffEnd) bad('Unreadable WebP structure.');
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      const chunk = Buffer.from(b.subarray(at, Math.min(end, riffEnd)));
      if (fourcc === 'VP8X' && size >= 1) chunk[8] &= ~0x0c;
      chunks.push(chunk);
    }
    at = end;
  }
  const body = Buffer.concat(chunks), head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

// GIF: drop comment extensions and application extensions other than the animation loop count.
function stripGif(b) {
  if (b.length < 13) bad('Not a GIF image.');
  let at = 13;
  const flags = b[10];
  if (flags & 0x80) at += 3 * (1 << ((flags & 7) + 1));
  if (at > b.length) bad('Unreadable GIF structure.');
  const parts = [b.subarray(0, at)];
  const subBlocks = from => { let p = from; while (true) { if (p >= b.length) bad('Unreadable GIF structure.'); const n = b[p]; p += 1 + n; if (n === 0) return p; } };
  while (at < b.length) {
    const introducer = b[at];
    if (introducer === 0x3b) { parts.push(b.subarray(at, at + 1)); return Buffer.concat(parts); }
    if (introducer === 0x21) {
      const label = b[at + 1], end = subBlocks(at + 2);
      const application = label === 0xff ? b.subarray(at + 3, at + 14).toString('latin1') : '';
      const keep = label === 0xf9 || label === 0x01 || (label === 0xff && (application === 'NETSCAPE2.0' || application === 'ANIMEXTS1.0'));
      if (keep) parts.push(b.subarray(at, end));
      at = end;
    } else if (introducer === 0x2c) {
      let p = at + 10;
      const local = b[at + 9];
      if (local & 0x80) p += 3 * (1 << ((local & 7) + 1));
      const end = subBlocks(p + 1);
      parts.push(b.subarray(at, end));
      at = end;
    } else bad('Unreadable GIF structure.');
  }
  bad('Unreadable GIF structure.');
}

// MP4: phones keep location, device and owner details in "udta" and "meta" boxes inside the movie header,
// and some editors add an XMP "uuid" box. Those boxes are renamed to "free" (padding players skip) and their
// contents zeroed, which keeps every size and offset the video frames depend on.
const XMP_UUID = Buffer.from('be7acfcb97a942e89c71999491e3afac', 'hex');
function stripMp4(b) {
  const out = Buffer.from(b);
  const walk = (from, to, depth) => {
    let at = from;
    while (at + 8 <= to) {
      let size = out.readUInt32BE(at), header = 8;
      const type = out.subarray(at + 4, at + 8).toString('latin1');
      if (size === 1) {
        if (at + 16 > to) bad('Unreadable MP4 structure.');
        const large = out.readBigUInt64BE(at + 8);
        if (large > BigInt(to - at)) bad('Unreadable MP4 structure.');
        size = Number(large); header = 16;
      } else if (size === 0) size = to - at;
      if (size < header || at + size > to) bad('Unreadable MP4 structure.');
      const blank = () => { out.write('free', at + 4, 'latin1'); out.fill(0, at + header, at + size); };
      if (depth > 0 && (type === 'udta' || type === 'meta')) blank();
      else if (type === 'uuid' && size >= header + 16 && out.subarray(at + header, at + header + 16).equals(XMP_UUID)) blank();
      else if (type === 'moov' || type === 'trak') walk(at + header, at + size, depth + 1);
      at += size;
    }
  };
  walk(0, out.length, 0);
  return out;
}
