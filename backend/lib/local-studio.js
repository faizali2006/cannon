const path = require('node:path');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

const modelPath = `file:///${path.resolve(__dirname, '../../node_modules/@imgly/background-removal-node/dist').replace(/\\/g, '/')}/`;
let enhancementQueue = Promise.resolve();

async function createStudioImage(buffer, mimeType) {
  const foregroundBlob = await removeBackground(new Blob([buffer], { type: mimeType }), {
    publicPath: modelPath,
    model: 'medium',
    output: { format: 'image/png', quality: 1, type: 'foreground' }
  });
  const foregroundBuffer = Buffer.from(await foregroundBlob.arrayBuffer());
  const productBuffer = await sharp(foregroundBuffer)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize({ width: 860, height: 860, fit: 'inside', withoutEnlargement: false })
    .modulate({ brightness: 1.05, saturation: 1.015 })
    .linear(1.025, -2)
    .sharpen({ sigma: 0.35 })
    .png()
    .toBuffer();

  const metadata = await sharp(productBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 800;
  const left = Math.round((1024 - width) / 2);
  const top = Math.round((1024 - height) / 2 - 8);
  const shadowY = Math.min(970, top + height - 4);
  const shadowWidth = Math.max(120, Math.round(width * 0.7));
  const shadowHeight = Math.max(18, Math.round(height * 0.045));
  const shadow = Buffer.from(`<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><defs><filter id="blur"><feGaussianBlur stdDeviation="14"/></filter></defs><ellipse cx="512" cy="${shadowY}" rx="${Math.round(shadowWidth / 2)}" ry="${Math.round(shadowHeight / 2)}" fill="#55483f" fill-opacity="0.18" filter="url(#blur)"/></svg>`);

  return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#F7F5F0' } })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: productBuffer, left, top }
    ])
    .jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function enhanceProductLocally(buffer, mimeType) {
  const task = enhancementQueue.then(() => createStudioImage(buffer, mimeType));
  enhancementQueue = task.catch(() => undefined);
  return task;
}

module.exports = { enhanceProductLocally };
