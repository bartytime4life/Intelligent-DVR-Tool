import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [modulePath, corpusPath, outputPath] = process.argv.slice(2);
const { analyzeImage } = await import(pathToFileURL(modulePath).href);
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');
const images = new Map(corpus.images.map(image => [image.id, image]));
const observations = corpus.cases.map(item => {
  const encoded = images.get(item.image);
  const data = Uint8ClampedArray.from(Buffer.from(encoded.rgba_base64, 'base64'));
  const before = digest(data);
  try {
    const result = analyzeImage({ width: encoded.width, height: encoded.height, data }, item.region);
    return { id: item.id, result, inputUnchanged: before === digest(data) };
  } catch (error) {
    return { id: item.id, error: String(error), inputUnchanged: before === digest(data) };
  }
});
fs.writeFileSync(outputPath, JSON.stringify({ observations }, (key, value) =>
  typeof value === 'number' && !Number.isFinite(value) ? { nonfinite: String(value) } : value, 2) + '\n');
