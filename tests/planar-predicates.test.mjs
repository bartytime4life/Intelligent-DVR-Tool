import test from 'node:test';
import assert from 'node:assert/strict';
import {finitePoint, orientationSign} from '../src/planar-predicates.mjs';

test('exact orientation retains signs through cancellation, underflow and overflow', () => {
  const u=2**-52, tiny=Number.MIN_VALUE, huge=Number.MAX_VALUE;
  const triples=[
    [[0,0],[1,0],[0,1],1],
    [[0,0],[1,1+u],[1-u,1],1],
    [[0,0],[tiny,0],[0,tiny],1],
    [[-huge,-huge],[huge,-huge],[-huge,huge],1],
    [[huge,huge],[0,0],[-huge,-huge],0],
    [[0,-0],[-0,0],[0,0],0]
  ];
  for(const [o,a,b,sign] of triples){
    assert.equal(orientationSign(o,a,b),sign);
    assert.equal(orientationSign(a,b,o),sign);
    assert.equal(orientationSign(o,b,a),sign===0?0:-sign);
  }
});

test('exact orientation rejects malformed finite-coordinate pairs including sparse arrays', () => {
  const invalid=[null,{},[],[1],[1,2,3],['1',2],[NaN,0],[0,Infinity],Array(2),[0,,]];
  for(const value of invalid){
    assert.equal(finitePoint(value),false);
    for(const points of [[value,[0,0],[1,1]],[[0,0],value,[1,1]],[[0,0],[1,1],value]])
      assert.equal(orientationSign(...points),null);
  }
  assert.equal(finitePoint([-0,Number.MIN_VALUE]),true);
});
