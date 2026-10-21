import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripMetadata, MediaMetadataError} from './somalia-flood-watch/media-metadata.mjs';
import {createCommunityHandler, reviewKeysFrom} from './somalia-flood-watch/community.mjs';

const GPS = 'GPS 2.0469N 45.3182E owner Halima';
const has = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
const segment = (marker, data) => { const head = Buffer.from([0xff, marker, 0, 0]); head.writeUInt16BE(data.length + 2, 2); return Buffer.concat([head, data]); };

// A big-endian Exif block with Orientation and a pretend GPS pointer, followed by GPS text.
function exif(orientation) {
  const tiff = Buffer.from([0x4d,0x4d,0,42, 0,0,0,8, 0,2, 0x01,0x12, 0,3, 0,0,0,1, 0,orientation,0,0, 0x88,0x25, 0,4, 0,0,0,1, 0,0,0,38, 0,0,0,0]);
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from(GPS, 'latin1')]);
}
function jpeg(orientation = 6) {
  const scan = Buffer.from([0xff,0xda,0,8,1,1,0,0,0x3f,0, 0x12,0x34,0xff,0x00,0x56, 0xff,0xd9]);
  return Buffer.concat([Buffer.from([0xff,0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, exif(orientation)),
    segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>' + GPS + '</x:xmpmeta>', 'latin1')),
    segment(0xed, Buffer.from('Photoshop 3.0\0' + GPS, 'latin1')),
    segment(0xfe, Buffer.from(GPS, 'latin1')),
    segment(0xdb, Buffer.alloc(65, 1)),
    scan]);
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function pngWithText() {
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1'); return Buffer.concat([head, data, Buffer.alloc(4)]); };
  return Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.from('Comment\0' + GPS, 'latin1')), chunk('eXIf', exif(1).subarray(6)), png.subarray(33)]);
}
function webp() {
  const chunk = (fourcc, data) => { const head = Buffer.alloc(8); head.write(fourcc, 0, 'latin1'); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]); };
  const body = Buffer.concat([chunk('VP8X', Buffer.from([0x0c,0,0,0, 0,0,0, 0,0,0])), chunk('VP8L', Buffer.from([0x2f,0,0,0,0x10,0x07,0x10,0x11,0x11,0x88,0x88,0xfe,0x07,0x00])), chunk('EXIF', exif(1).subarray(6)), chunk('XMP ', Buffer.from(GPS, 'latin1'))]);
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
function gif() {
  return Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1,0,1,0, 0,0,0]),
    Buffer.from([0x21,0xfe, GPS.length]), Buffer.from(GPS, 'latin1'), Buffer.from([0]),
    Buffer.from([0x21,0xff,11]), Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([3,1,0,0, 0]),
    Buffer.from([0x21,0xff,11]), Buffer.from('XMP DataXMP', 'latin1'), Buffer.from([GPS.length]), Buffer.from(GPS, 'latin1'), Buffer.from([0]),
    Buffer.from([0x2c, 0,0,0,0, 1,0,1,0, 0, 2, 2,0x44,0x01, 0]), Buffer.from([0x3b])]);
}
function mp4() {
  const box = (type, ...children) => { const body = Buffer.concat(children.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c, 'latin1'))); const head = Buffer.alloc(8); head.writeUInt32BE(body.length + 8, 0); head.write(type, 4, 'latin1'); return Buffer.concat([head, body]); };
  return Buffer.concat([box('ftyp', 'isom', Buffer.from([0,0,2,0]), 'isomiso2mp41'),
    box('moov', box('mvhd', Buffer.alloc(20, 7)), box('trak', box('tkhd', Buffer.alloc(12, 5)), box('udta', 'track ' + GPS)), box('udta', box('\xa9xyz', '+02.0469+045.3182/')), box('meta', 'com.apple.quicktime.location.ISO6709 ' + GPS)),
    box('mdat', Buffer.alloc(32, 9))]);
}
const orientationOf = bytes => { const at = bytes.indexOf(Buffer.from('Exif\0\0', 'latin1')); return at < 0 ? null : bytes.readUInt16BE(at + 6 + 8 + 2 + 8); };

test('JPEG uploads lose GPS, XMP, IPTC and comments but keep orientation and the image data', () => {
  const input = jpeg(6), output = stripMetadata(input, 'image/jpeg');
  assert.ok(has(input, GPS));
  assert.equal(has(output, GPS), false);
  assert.equal(has(output, 'xmpmeta'), false);
  assert.equal(has(output, 'Photoshop'), false);
  assert.ok(has(output, 'JFIF'));
  assert.equal(orientationOf(output), 6);
  assert.ok(output.subarray(-17).equals(input.subarray(-17)), 'scan data and end marker are copied unchanged');
  assert.equal(orientationOf(stripMetadata(jpeg(1), 'image/jpeg')), null, 'normal orientation needs no Exif at all');
  assert.throws(() => stripMetadata(input.subarray(0, 30), 'image/jpeg'), MediaMetadataError);
});

test('PNG, WebP and GIF uploads lose text and metadata chunks', () => {
  assert.ok(stripMetadata(pngWithText(), 'image/png').equals(png), 'the PNG returns to its clean original');
  assert.ok(stripMetadata(png, 'image/png').equals(png), 'a clean PNG is unchanged');
  const cleanWebp = stripMetadata(webp(), 'image/webp');
  assert.equal(has(cleanWebp, GPS), false);
  assert.equal(has(cleanWebp, 'EXIF'), false);
  assert.equal(cleanWebp.readUInt32LE(4), cleanWebp.length - 8);
  assert.equal(cleanWebp[20] & 0x0c, 0, 'VP8X no longer claims EXIF or XMP');
  assert.ok(has(cleanWebp, 'VP8L'));
  const cleanGif = stripMetadata(gif(), 'image/gif');
  assert.equal(has(cleanGif, GPS), false);
  assert.ok(has(cleanGif, 'NETSCAPE2.0'), 'animation loop count is kept');
  assert.equal(cleanGif.at(-1), 0x3b);
});

test('MP4 uploads lose location boxes without moving the video data', () => {
  const input = mp4(), output = stripMetadata(input, 'video/mp4');
  assert.equal(output.length, input.length);
  assert.equal(has(output, GPS), false);
  assert.equal(has(output, '+02.0469'), false);
  assert.ok(output.subarray(-40).equals(input.subarray(-40)), 'mdat is untouched');
  assert.ok(has(output, 'mvhd') && has(output, 'tkhd'));
  assert.throws(() => stripMetadata(input.subarray(0, input.length - 5), 'video/mp4'), MediaMetadataError);
});

test('the community API stores cleaned files and refuses unreadable ones', async () => {
  const folder = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), 'media-metadata-test-'));
  // New reports are held for review, so the reviewer's key reads the stored file.
  const reviewKey = 'media-test-review-key-0123456789';
  const handler = createCommunityHandler({dataDir:folder, cities:[{id:'mogadishu', name:'Mogadishu'}], reviewers:reviewKeysFrom({reviewKeys:reviewKey})});
  const server = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const payload = {cityId:'mogadishu', category:'flood', observedAt:new Date(Date.now() - 60000).toISOString(), description:'Water is covering this street after heavy rain.', author:'Neighbour', latitude:null, longitude:null, deaths:null, injuries:null, damagedProperties:null};
  const post = (bytes, type) => { const form = new FormData(); form.set('payload', JSON.stringify(payload)); form.append('media', new Blob([bytes], {type}), 'phone.jpg'); return fetch(origin + '/api/community/reports', {method:'POST', headers:{Origin:origin}, body:form}); };
  try {
    let response = await post(jpeg(6), 'image/jpeg');
    assert.equal(response.status, 201);
    const {report} = await response.json();
    const served = Buffer.from(await (await fetch(origin + report.media[0].url, {headers:{'X-Review-Key':reviewKey}})).arrayBuffer());
    assert.equal(has(served, GPS), false);
    assert.equal(orientationOf(served), 6);
    const files = (await readdir(path.join(folder, 'media')));
    for (const file of files) assert.equal(has(await readFile(path.join(folder, 'media', file)), GPS), false, 'nothing with a location is written to disk');
    response = await post(jpeg(6).subarray(0, 30), 'image/jpeg');
    assert.equal(response.status, 415);
  } finally {
    server.close(); await rm(folder, {recursive:true, force:true});
  }
});
