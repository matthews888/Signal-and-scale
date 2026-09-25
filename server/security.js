import { createHash, createHmac, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const fingerprint = (value, secret) => createHmac('sha256', secret).update(value).digest('hex');
export async function checkCode(code, stored) {
  if (!/^\d{6}$/.test(code || '') || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored || '')) return false;
  const [salt, hash] = stored.split(':');
  const actual = await derive(code, salt, 32);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function csvCell(value) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function isExpectedMedia(bytes, mime) {
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  if (mime === 'video/webm') return bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  if (['video/mp4','video/quicktime','image/heic'].includes(mime)) {
    if (bytes.toString('ascii',4,8)!=='ftyp') return false;
    const brand = bytes.toString('ascii',8,12);
    return mime === 'image/heic' ? ['heic','heix','hevc','hevx','mif1'].includes(brand) : !['heic','heix','hevc','hevx','mif1'].includes(brand);
  }
  return false;
}
