const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const config = require('./config');

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedAudioTypes = new Set(['audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg']);

function imageSignature(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24 && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === 'image/webp') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    const startOfFrame = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (startOfFrame.has(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
}

function validateImage(buffer, declaredMimeType) {
  const detectedMimeType = imageSignature(buffer);
  if (!detectedMimeType || detectedMimeType !== declaredMimeType) {
    throw Object.assign(new Error('Image content does not match its declared type'), { statusCode: 415 });
  }
  const dimensions = imageDimensions(buffer, detectedMimeType);
  if (!dimensions) {
    throw Object.assign(new Error('Image structure is invalid or unsupported'), { statusCode: 415 });
  }
  if (dimensions && (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > config.maxImageDimension || dimensions.height > config.maxImageDimension || dimensions.width * dimensions.height > config.maxImagePixels)) {
    throw Object.assign(new Error('Image dimensions are too large'), { statusCode: 413 });
  }
  return dimensions;
}

function parseDataUrl(dataUrl, kind) {
  if (typeof dataUrl !== 'string') throw Object.assign(new Error(`${kind} data is required`), { statusCode: 400 });
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw Object.assign(new Error(`Invalid ${kind} data URL`), { statusCode: 400 });
  const mimeType = match[1].toLowerCase();
  const allowed = kind === 'image' ? allowedImageTypes : allowedAudioTypes;
  if (!allowed.has(mimeType)) throw Object.assign(new Error(`Unsupported ${kind} type: ${mimeType}`), { statusCode: 415 });
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  const maximum = kind === 'image' ? config.maxImageBytes : config.maxAudioBytes;
  if (!buffer.length || buffer.length > maximum) {
    throw Object.assign(new Error(`${kind} must be smaller than ${Math.round(maximum / 1024 / 1024)} MB`), { statusCode: 413 });
  }
  const dimensions = kind === 'image' ? validateImage(buffer, mimeType) : null;
  return { mimeType, buffer, dimensions };
}

function extensionFor(mimeType) {
  return ({
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg'
  })[mimeType] || 'bin';
}

function saveBuffer(buffer, mimeType, prefix) {
  if (allowedImageTypes.has(mimeType)) validateImage(buffer, mimeType);
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const safePrefix = String(prefix || 'media').replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'media';
  const filename = `${safePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}.${extensionFor(mimeType)}`;
  fs.writeFileSync(path.join(config.uploadDir, filename), buffer);
  return `/uploads/${filename}`;
}

function saveDataUrl(dataUrl, kind, prefix) {
  const media = parseDataUrl(dataUrl, kind);
  return { ...media, url: saveBuffer(media.buffer, media.mimeType, prefix) };
}

function toDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function deleteMediaUrl(mediaUrl) {
  if (typeof mediaUrl !== 'string' || !mediaUrl.startsWith('/uploads/')) return false;
  const filename = path.basename(mediaUrl);
  const filePath = path.join(config.uploadDir, filename);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

module.exports = { parseDataUrl, saveBuffer, saveDataUrl, toDataUrl, extensionFor, deleteMediaUrl, validateImage, imageDimensions };
