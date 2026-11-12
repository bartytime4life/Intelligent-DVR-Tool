import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, compareImages, pixelRuler, regionBounds } from '../src/image-science.mjs';

const image = (width, height, sample) => ({ width, height, data: Uint8ClampedArray.from(Array.from({length: width * height}, (_, i) => [...sample(i % width, Math.floor(i / width)), 255]).flat()) });

test('image diagnostics: black and white regions retain bounded histogram totals and clipping', () => {
  const black = analyzeImage(image(4, 4, () => [0, 0, 0]));
  assert.equal(black.mean, 0); assert.equal(black.shadowPercent, 100);
  assert.equal(black.highlightPercent, 0); assert.equal(black.sobel, 0);
  assert.equal(black.sobelSamples, 4); assert.equal(black.sobelMeanMagnitude, 0);
  assert.equal(black.method, 'srgb-luma-sobel-max-v2');
  assert.equal(black.sobelMaximum, 255 * Math.sqrt(20));
  assert.equal(black.histogram.reduce((a, b) => a + b, 0), 16);
  const white = analyzeImage(image(4, 4, () => [255, 255, 255]));
  assert.equal(white.mean, 255); assert.equal(white.highlightPercent, 100);
  assert.equal(white.low, 255); assert.equal(white.high, 255);
  assert.equal(white.sobel, 0); assert.equal(white.sobelSamples, 4);
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

test('image diagnostics: RGBA alpha is composited over black for luma and frame differences', () => {
  const rgba = (r,g,b,a) => ({width:4,height:4,
    data:Uint8ClampedArray.from(Array.from({length:16},()=>[r,g,b,a]).flat())});
  const transparentWhite = rgba(255,255,255,0);
  const halfWhite = rgba(255,255,255,128);
  const opaqueWhite = rgba(255,255,255,255);
  assert.equal(analyzeImage(transparentWhite).mean,0);
  assert.equal(analyzeImage(halfWhite).mean,128);
  assert.equal(analyzeImage(halfWhite).shadowPercent,0);
  assert.equal(analyzeImage(halfWhite).highlightPercent,0);
  assert.equal(analyzeImage(opaqueWhite).mean,255);
  assert.equal(compareImages(transparentWhite,opaqueWhite).changedPercent,100);
  assert.equal(compareImages(halfWhite,opaqueWhite).changedPercent,100);
  assert.equal(compareImages(halfWhite,halfWhite).meanAbsoluteDifference,0);
});

test('image diagnostics: one- and two-pixel ROI dimensions have no Sobel support', () => {
  const source=image(8,8,(x,y)=>(x+y)%2?[255,255,255]:[0,0,0]);
  for(const width of [1,2]) for(const height of [1,2,8]) {
    for(const [w,h] of [[width,height],[height,width]]) {
      const result=analyzeImage(source,{x:0,y:0,width:w/8,height:h/8});
      assert.equal(result.width,w); assert.equal(result.height,h);
      assert.equal(result.pixels,w*h);
      assert.equal(result.sobelSamples,0);
      assert.equal(result.sobel,null); assert.equal(result.sobelMeanMagnitude,null);
      assert.equal(result.sobelMaximum,255*Math.sqrt(20));
      assert.ok(Number.isFinite(result.mean));
      assert.equal(result.histogram.reduce((a,b)=>a+b,0),w*h);
    }
  }
  for(const [w,h] of [[1,7],[2,7],[7,1],[7,2]]) {
    const result=analyzeImage(image(w,h,()=>[128,128,128]));
    assert.equal(result.sobelSamples,0); assert.equal(result.sobel,null);
  }
});

test('image diagnostics: enumerating all 512 binary patches proves the exact reachable Sobel L2 maximum', () => {
  // A linear two-component gradient followed by a convex norm attains its
  // maximum on a box vertex. Enumerate all 3x3 binary vertices independently.
  const kernelX=[-1,0,1,-2,0,2,-1,0,1],kernelY=[-1,-2,-1,0,0,0,1,2,1];
  let maximumSquared=0,maximumPercent=0,maximumMagnitude=0;
  for(let bits=0;bits<512;bits++) {
    const patch=Array.from({length:9},(_,i)=>(bits>>i&1)*255);
    const gx=patch.reduce((sum,value,i)=>sum+value*kernelX[i],0);
    const gy=patch.reduce((sum,value,i)=>sum+value*kernelY[i],0);
    const squared=gx*gx+gy*gy;
    const result=analyzeImage(image(3,3,(x,y)=>new Array(3).fill(patch[y*3+x])));
    assert.equal(result.sobelSamples,1);
    assert.ok(Math.abs(result.sobelMeanMagnitude-Math.sqrt(squared))<1e-10);
    assert.ok(Math.abs(result.sobel-100*Math.sqrt(squared/(20*255*255)))<1e-12);
    assert.ok(result.sobel>=0 && result.sobel<=100);
    maximumSquared=Math.max(maximumSquared,squared);
    maximumPercent=Math.max(maximumPercent,result.sobel);
    maximumMagnitude=Math.max(maximumMagnitude,result.sobelMeanMagnitude);
  }
  assert.equal(maximumSquared,20*255*255);
  assert.equal(maximumMagnitude,255*Math.sqrt(20));
  assert.equal(maximumPercent,100);
});

test('image diagnostics: Sobel is invariant under quarter rotation, transpose and luma complement', () => {
  const patch=[[3,64,255],[17,100,210],[0,123,240]];
  const transpose=matrix=>matrix[0].map((_,x)=>matrix.map(row=>row[x]));
  const rotation=matrix=>transpose(matrix).map(row=>row.slice().reverse());
  const evaluate=matrix=>analyzeImage(image(3,3,(x,y)=>new Array(3).fill(matrix[y][x])));
  const expected=evaluate(patch);
  let rotated=patch;
  for(let turn=0;turn<4;turn++) {
    for(const matrix of [rotated,transpose(rotated),rotated.map(row=>row.map(value=>255-value))]) {
      const result=evaluate(matrix);
      assert.equal(result.sobelSamples,1);
      assert.ok(Math.abs(result.sobel-expected.sobel)<1e-12);
      assert.ok(Math.abs(result.sobelMeanMagnitude-expected.sobelMeanMagnitude)<1e-10);
    }
    rotated=rotation(rotated);
  }
});

test('image diagnostics: reported Sobel is the mean of magnitudes, not RMS or an edge-pixel percentage', () => {
  const row=[0,0,255,255,255];
  const result=analyzeImage(image(5,3,x=>new Array(3).fill(row[x])));
  // The three valid centres have independent horizontal magnitudes 1020,1020,0.
  const expected=(1020+1020+0)/3;
  assert.equal(result.sobelSamples,3);
  assert.ok(Math.abs(result.sobelMeanMagnitude-expected)<1e-10);
  assert.ok(Math.abs(result.sobel-100*expected/result.sobelMaximum)<1e-12);
  assert.ok(Math.abs(result.sobel-100*Math.sqrt((1020**2+1020**2)/3)/result.sobelMaximum)>1);
  assert.ok(Math.abs(result.sobel-200/3)>1);
});

test('image diagnostics: Sobel black-alpha composition matches the equivalent opaque grayscale raster', () => {
  const samples=[[255,0,0,128],[0,255,0,255],[0,0,255,64],[255,255,255,0]];
  const expected=[27,182,5,0];
  const rgba={width:6,height:5,data:Uint8ClampedArray.from(Array.from({length:30},(_,i)=>samples[i%4]).flat())};
  const grayscale=image(6,5,(x,y)=>new Array(3).fill(expected[(y*6+x)%4]));
  assert.deepEqual(analyzeImage(rgba),analyzeImage(grayscale));
  assert.equal(compareImages(rgba,grayscale).meanAbsoluteDifference,0);
  assert.equal(compareImages(rgba,grayscale).changedPercent,0);
});

test('image diagnostics: Sobel neighbours stay inside the selected ROI and match an explicit crop', () => {
  const region={x:.25,y:.125,width:.5,height:.625}; // A 4x5 crop of the 8x8 raster.
  const sample=(x,y)=>(x*53+y*79)%256;
  const cropped=image(4,5,(x,y)=>new Array(3).fill(sample(x,y)));
  for(const outside of [0,255]) {
    const source=image(8,8,(x,y)=>new Array(3).fill(x>=2&&x<6&&y>=1&&y<6?sample(x-2,y-1):outside));
    const result=analyzeImage(source,region);
    assert.deepEqual(result,analyzeImage(cropped));
    assert.equal(result.sobelSamples,6);
  }
  const framed=image(8,8,(x,y)=>new Array(3).fill(x>=2&&x<6&&y>=2&&y<6?128:0));
  const flat=analyzeImage(framed,{x:.25,y:.25,width:.5,height:.5});
  assert.equal(flat.sobelSamples,4); assert.equal(flat.sobel,0);
  assert.equal(flat.sobelMeanMagnitude,0); assert.ok(analyzeImage(framed).sobel>0);
});
