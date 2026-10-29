import test from 'node:test';
import assert from 'node:assert/strict';
import {resizeShape,moveShape,resizeEdge,shapeBounds,unitFactor,displayLength} from '../src/facility-shape-edit.mjs';
const shape={footprint:[[0,0],[10,0],[10,20],[0,20],[0,0]],holes:[[[2,2],[4,2],[4,4],[2,4],[2,2]]]};
test('feet entry converts exact physical geometry without unit-toggle mutation',()=>{assert.equal(unitFactor('imperial'),.3048);assert.equal(displayLength(3.048,'imperial'),10);assert.equal(displayLength(3.048,'metric'),3.048);assert.equal(shapeBounds(resizeShape(shape,'width',10*.3048)).width,3.048);});
test('resizing and moving preserve courtyard relation and immutable original',()=>{const s=resizeShape(shape,'width',20);assert.deepEqual(s.holes[0][0],[-1,2]);assert.equal(shapeBounds(s).x,5);assert.equal(shapeBounds(moveShape(s,'x',50)).x,50);assert.deepEqual(shape.holes[0][0],[2,2]);});
test('individual edge length updates its end and maintains ring closure',()=>{assert.equal(resizeEdge(shape,0,12).footprint[1][0],12);const r=resizeEdge(shape,3,10).footprint;assert.deepEqual(r[0],r.at(-1));assert.equal(Math.hypot(r[4][0]-r[3][0],r[4][1]-r[3][1]),10);assert.throws(()=>resizeEdge(shape,0,NaN));});
