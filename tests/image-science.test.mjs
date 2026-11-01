import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, compareImages, pixelRuler, regionBounds } from '../src/image-science.mjs';

const image = (width, height, sample) => ({ width, height, data: Uint8ClampedArray.from(Array.from({length: width * height}, (_, i) => [...sample(i % width, Math.floor(i / width)), 255]).flat()) });

test('image diagnostics: black and white regions retain bounded histogram totals and clipping', () => {
  const black = analyzeImage(image(4, 4, () => [0, 0, 0]));
  assert.equal(black.mean, 0); assert.equal(black.shadowPercent, 100);
  assert.equal(black.highlightPercent, 0); assert.equal(black.sobel, 0);
  assert.equal(black.histogram.reduce((a, b) => a + b, 0), 16);
  const white = analyzeImage(image(4, 4, () => [255, 255, 255]));
  assert.equal(white.mean, 255); assert.equal(white.highlightPercent, 100);
  assert.equal(white.low, 255); assert.equal(white.high, 255);
});

test('image diagnostics: explicit ROI never includes pixels outside its bounds', () => {
  const split = image(8, 8, x => x < 4 ? [0,0,0] : [255,255,255]);
  const left = analyzeImage(split,{x:0,y:0,width:0.5,height:1});
  const right = analyzeImage(split,{x:0.5,y:0,width:0.5,height:1});
  assert.equal(left.pixels,32); assert.equal(left.mean,0);
  assert.equal(right.pixels,32); assert.equal(right.mean,255);
  const all = analyzeImage(split);
  assert.equal(all.mean,127.5);
  assert.ok(all.sobel > 0);
});

test('image diagnostics: region bounds clamp invalid input and leave nonempty region', () => {
  assert.deepEqual(regionBounds({x:2,y:2,width:1,height:1},8,6),{left:7,top:5,right:8,bottom:6});
  assert.throws(() => regionBounds(undefined,0,6),RangeError);
  assert.throws(() => analyzeImage({width:2,height:2,data:new Uint8Array(3)}),/bounded RGBA/);
});

test('image diagnostics: frame comparison uses exact matching dimensions and threshold', () => {
  const a=image(4,4,()=>[0,0,0]), b=image(4,4,()=>[100,100,100]);
  assert.deepEqual(compareImages(a,a),{meanAbsoluteDifference:0,changedPercent:0,threshold:24,pixels:16});
  assert.equal(compareImages(a,b).changedPercent,100);
  assert.equal(compareImages(a,b,{x:0,y:0,width:.5,height:1},110).changedPercent,0);
  assert.equal(compareImages(a,image(2,2,()=>[0,0,0])),null);
});

test('image diagnostics: pixel ruler reports image pixels, not fake metres', () => {
  assert.equal(pixelRuler({x:0,y:0},{x:.3,y:.4},100,100),50);
  assert.equal(pixelRuler(null,{x:1,y:1},100,100),null);
});
