#!/usr/bin/env python3
"""Independent generated-image Sobel oracle; Python stdlib only.

This uses integer kernel-matrix dot products on flattened 3x3 patches, exact
rational black-composited luma, and 70-digit Decimal square roots. It does not
import application logic or translate its indexed gradient expressions.
The strict --require-pass option has been present since the baseline run.
"""
import argparse
import base64
from collections import Counter
from decimal import Decimal, localcontext
from fractions import Fraction
import gzip
import hashlib
import json
from pathlib import Path
import random
import subprocess
import sys

HERE = Path(__file__).resolve().parent
KX = (-1, 0, 1, -2, 0, 2, -1, 0, 1)
KY = (-1, -2, -1, 0, 0, 0, 1, 2, 1)
BOUND_SQUARED = 20 * 255**2
BASELINE_SHA = '6f576c07939b35ed2a479494b1dc1ebdaeba8ba9fc1fe715dff814268124c7f9'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encoded(obj):
    return (json.dumps(obj, sort_keys=True, separators=(',', ':')) + '\n').encode()

def gradient(patch):
    return (sum(a*b for a,b in zip(KX, patch)), sum(a*b for a,b in zip(KY, patch)))

def exact_luma(pixel):
    r,g,b,a = pixel
    value = Fraction((2126*r + 7152*g + 722*b)*a, 10000*255)
    # Math.round for nonnegative input. Random RGB generation avoids exact .5
    # ties so binary evaluation order cannot create an irrelevant luma dispute.
    return (2*value.numerator + value.denominator)//(2*value.denominator)

def enumerate_vertices():
    responses = []
    for bits in range(512):
        patch = [255*((bits >> k) & 1) for k in range(9)]
        gx,gy = gradient(patch)
        responses.append({'bits': bits, 'patch': patch, 'gx': gx, 'gy': gy, 'squared': gx*gx+gy*gy})
    maximum = max(row['squared'] for row in responses)
    assert maximum == BOUND_SQUARED
    maximizers = [row for row in responses if row['squared'] == maximum]
    assert len(maximizers) == 16
    with localcontext() as context:
        context.prec = 70
        magnitude = str(Decimal(maximum).sqrt())
    return {
      'kernel_x': KX, 'kernel_y': KY, 'binary_patches': len(responses),
      'distinct_noncentre_vertex_patches': 256, 'maximum_squared': maximum,
      'maximum_squared_factored': '20 * 255^2', 'maximum_magnitude_decimal': magnitude,
      'maximizer_count_including_free_centre': len(maximizers), 'maximizers': maximizers,
      'argument': [
        'Each response is a linear map A from nine luma samples into R^2.',
        'The squared Euclidean norm ||A p||^2 is convex in p.',
        'Every p in the continuous cube [0,255]^9 is a convex combination of its binary vertices.',
        'Jensen inequality bounds every cube response by the maximum over those 512 vertices.',
        'Exact integer enumeration attains 20*255^2; therefore 255*sqrt(20) is the tight bound.',
        'The centre coefficient is zero in both kernels, explaining the doubled maximizer count.',
        'A region mean of nonnegative magnitudes is bounded by the same maximum; this is not RMS.',
      ],
      'primary_source': 'https://docs.opencv.org/4.13.0/d2/d2c/tutorial_sobel_derivatives.html',
      'scope': '3x3 Sobel L2 response of rounded 8-bit sRGB luma composited over black; not optical sharpness or recognition quality',
    }

def rotate(rows):
    return [list(row) for row in zip(*rows[::-1])]

def variants(rows):
    out = []
    current = rows
    for index in range(4):
        out += [(f'rot{index}', current), (f'rot{index}-reflect', [row[::-1] for row in current])]
        current = rotate(current)
    return out

def make_corpus():
    images,cases,invariants = [],[],[]
    def add_image(name, rows):
        height,width = len(rows),len(rows[0])
        assert all(len(row) == width for row in rows)
        rgba = bytes(channel for row in rows for pixel in row for channel in pixel)
        images.append({'id': name, 'width': width, 'height': height, 'rgba_base64': base64.b64encode(rgba).decode()})
        return name
    def add_case(name, image, bounds, region=None, group=None):
        cases.append({'id': name, 'image': image, 'bounds': bounds, 'region': region,
                      'group': group or name.split('-')[0]})
    def full(name, rows, group=None):
        image = add_image(name, rows)
        add_case(name, image, [0,0,len(rows[0]),len(rows)], group=group)
    gray = lambda v: [v,v,v,255]
    for bits in range(512):
        values = [255*((bits >> k)&1) for k in range(9)]
        full(f'binary-{bits:03d}', [[gray(values[y*3+x]) for x in range(3)] for y in range(3)], 'binary')
    for width,height in [(1,1),(1,7),(2,7),(7,1),(7,2),(3,3),(4,4)]:
        for value in [0,73,255]:
            full(f'constant-{width}x{height}-{value}', [[gray(value) for x in range(width)] for y in range(height)], 'constant')
    rng = random.Random(0x50BE12026)
    gray_rows = [[gray(rng.randrange(256)) for x in range(13)] for y in range(9)]
    gray_names = []
    for transform,rows in variants(gray_rows):
        for invert in [False,True]:
            name = f'gray-invariance-{transform}-complement{int(invert)}'
            transformed = [[[255-pixel[0]]*3+[255] for pixel in row] for row in rows] if invert else rows
            full(name, transformed, 'gray-invariance')
            gray_names.append(name)
    invariants.append({'name': 'opaque-gray-dihedral-and-complement', 'case_ids': gray_names})
    def color_pixel():
        while True:
            pixel = [rng.randrange(256) for k in range(3)] + [rng.choice([0,64,128,192,255])]
            numerator = (2126*pixel[0]+7152*pixel[1]+722*pixel[2])*pixel[3]
            if (2*numerator) % (2*10000*255) != 10000*255:
                return pixel
    color_rows = [[color_pixel() for x in range(11)] for y in range(7)]
    color_names = []
    for transform,rows in variants(color_rows):
        name = f'alpha-invariance-{transform}'
        full(name, rows, 'alpha-invariance')
        color_names.append(name)
    invariants.append({'name':'rgba-dihedral','case_ids':color_names})
    for index in range(40):
        width,height = rng.randrange(3,33),rng.randrange(3,33)
        rows = [[color_pixel() for x in range(width)] for y in range(height)]
        name=f'rgba-random-{index:02d}'
        image=add_image(name, rows)
        # Exact binary fractions; selected pixel bounds independently specified.
        left_fraction,top_fraction = rng.randrange(0,8)/16,rng.randrange(0,8)/16
        width_fraction,height_fraction = rng.randrange(1,9)/16,rng.randrange(1,9)/16
        left,top=int(left_fraction*width),int(top_fraction*height)
        right=-int(-(left_fraction+width_fraction)*width//1)
        bottom=-int(-(top_fraction+height_fraction)*height//1)
        add_case(name,image,[left,top,max(left+1,right),max(top+1,bottom)],
                 {'x':left_fraction,'y':top_fraction,'width':width_fraction,'height':height_fraction},'rgba-random')
    for name,pattern in [
        ('step-x',lambda x,y:255*(x>=4)),('step-y',lambda x,y:255*(y>=4)),
        ('diagonal',lambda x,y:255*(x>=y)),('impulse',lambda x,y:255*(x==3 and y==4)),
        ('checkerboard',lambda x,y:255*((x+y)%2)),('ramp',lambda x,y:11*x+7*y),
    ]:
        full(name,[[gray(pattern(x,y)) for x in range(8)] for y in range(8)],'structured')
    thin=add_image('large-generated-step',[[gray(255*(x>=360)) for x in range(720)] for y in range(720)])
    for name,region,bounds in [
        ('thin-height-one',{'x':0,'y':0,'width':1,'height':1/1024},[0,0,720,1]),
        ('thin-height-two',{'x':0,'y':0,'width':1,'height':.002},[0,0,720,2]),
        ('thin-width-one',{'x':0,'y':0,'width':1/1024,'height':1},[0,0,1,720]),
        ('thin-width-two',{'x':0,'y':0,'width':.002,'height':1},[0,0,2,720]),
        ('small-three-wide',{'x':.25,'y':.25,'width':1/256,'height':1/256},[180,180,183,183]),
        ('edge-small-three',{'x':.5-1/1024,'y':.25,'width':1/256,'height':1/256},[359,180,363,183]),
    ]:
        add_case(name,thin,bounds,region,'large-roi')
    # Same selected region with entirely different exterior pixels: no borrowed
    # support from outside the ROI is allowed by this diagnostic contract.
    roi_names=[]
    for exterior in [0,255]:
        rows=[[gray(exterior) for x in range(8)] for y in range(8)]
        for y in range(2,6):
            for x in range(2,6): rows[y][x]=gray((53*x+31*y)%256)
        name=f'roi-exterior-{exterior}'
        image=add_image(name,rows)
        add_case(name,image,[2,2,6,6],{'x':.25,'y':.25,'width':.5,'height':.5},'roi-boundary')
        roi_names.append(name)
    invariants.append({'name':'selected-region-exterior-independent','case_ids':roi_names})
    return {'version':1,'seed':'0x50BE12026','images':images,'cases':cases,'invariants':invariants,
            'scope':'Generated RGBA only; no frames, models, cameras or network data.'}

def expected_cases(corpus):
    shades={}
    dimensions={}
    for image in corpus['images']:
        rgba=base64.b64decode(image['rgba_base64'])
        shades[image['id']]=[exact_luma(rgba[index:index+4]) for index in range(0,len(rgba),4)]
        dimensions[image['id']]=(image['width'],image['height'])
    expected={}
    with localcontext() as context:
        context.prec=70
        bound=Decimal(BOUND_SQUARED).sqrt()
        for case in corpus['cases']:
            width,height=dimensions[case['image']]
            luma=shades[case['image']]
            left,top,right,bottom=case['bounds']
            selected=[luma[row*width+column] for row in range(top,bottom) for column in range(left,right)]
            frequencies=Counter(selected)
            # Extract complete 3x3 tiles by their TOP-LEFT location, flatten,
            # and apply kernel matrix dot products. No application indexing.
            squares=[]
            for row in range(top,bottom-2):
                for column in range(left,right-2):
                    patch=sum((luma[y*width+column:y*width+column+3] for y in range(row,row+3)),[])
                    gx,gy=gradient(patch)
                    squares.append(gx*gx+gy*gy)
            samples=max(0,right-left-2)*max(0,bottom-top-2)
            assert len(squares)==samples
            raw=sum((Decimal(value).sqrt() for value in squares),Decimal(0))/samples if samples else None
            rms=(Decimal(sum(squares))/samples).sqrt() if samples else None
            ordered=sorted(selected)
            def quantile(numerator,denominator):
                rank=max(1,(len(selected)*numerator+denominator-1)//denominator)
                return ordered[rank-1]
            expected[case['id']]={
                'method':'srgb-luma-sobel-max-v2','sobelMaximum':str(bound),
                'sobelSamples':samples,'sobelMeanMagnitude':str(raw) if raw is not None else None,
                'sobel':str(raw/bound*100) if raw is not None else None,
                'pixels':len(selected),'width':right-left,'height':bottom-top,
                'mean':str(Decimal(sum(selected))/len(selected)),
                'low':quantile(5,100),'high':quantile(95,100),
                'shadowPercent':str(Decimal(sum(v<=15 for v in selected))/len(selected)*100),
                'highlightPercent':str(Decimal(sum(v>=240 for v in selected))/len(selected)*100),
                'histogram':[sum(frequencies[value] for value in range(start,start+16)) for start in range(0,256,16)],
                '_rms':str(rms) if rms is not None else None,
            }
    return expected

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze',action='store_true')
    parser.add_argument('--module',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--inputs',type=Path,help='Frozen JSON or .json.gz corpus; defaults to adjacent inputs.json, then inputs.json.gz.')
    parser.add_argument('--require-pass',action='store_true',help='Exit 1 for any failed mathematical assertion (including baseline).')
    args=parser.parse_args()
    corpus_path=HERE/'inputs.json'
    proof=enumerate_vertices()
    if args.freeze:
        payload=encoded(make_corpus())
        if corpus_path.exists() and corpus_path.read_bytes()!=payload:
            raise RuntimeError('Refusing to change frozen input corpus')
        corpus_path.write_bytes(payload)
        (HERE/'proof.json').write_bytes(encoded(proof))
    if args.inputs:
        corpus_path=args.inputs.resolve()
    elif not corpus_path.exists():
        corpus_path=HERE/'inputs.json.gz'
    stored_input=corpus_path.read_bytes()
    compressed=corpus_path.suffix=='.gz'
    input_bytes=gzip.decompress(stored_input) if compressed else stored_input
    corpus=json.loads(input_bytes)
    if not args.module:
        print(json.dumps({'input_sha256':sha(input_bytes),'images':len(corpus['images']),'cases':len(corpus['cases']),'proof_maximum_squared':proof['maximum_squared'],'maximizers':len(proof['maximizers'])},indent=2))
        return
    if not args.output:
        parser.error('--output required with --module')
    destination=args.output.resolve()
    destination.mkdir(parents=True,exist_ok=True)
    input_snapshot=destination/'inputs.snapshot.json'
    if input_snapshot.exists() and input_snapshot.read_bytes()!=input_bytes:
        raise RuntimeError('Refusing to overwrite differently bound input snapshot')
    input_snapshot.write_bytes(input_bytes)
    source=args.module.resolve().read_bytes()
    module_sha=sha(source)
    snapshot=destination/'image-science.snapshot.mjs'
    if snapshot.exists() and snapshot.read_bytes()!=source:
        raise RuntimeError('Refusing to overwrite differently bound module snapshot')
    snapshot.write_bytes(source)
    if args.module.resolve().read_bytes()!=source:
        raise RuntimeError('Source changed while snapshotting')
    process=subprocess.run(['node',str(HERE/'runner.mjs'),str(snapshot),str(input_snapshot),str(destination/'observations.json')],capture_output=True,text=True)
    if process.returncode:
        raise RuntimeError(f'Node runner failed: {process.stderr}')
    observed=json.loads((destination/'observations.json').read_text())['observations']
    actual={row['id']:row for row in observed}
    expected=expected_cases(corpus)
    (destination/'expected.json').write_bytes(encoded(expected))
    failures=[]
    categories=Counter()
    assertions=0
    max_errors=Counter()
    def failure(case,field,want,got):
        categories[field]+=1
        failures.append({'case':case,'field':field,'expected':want,'actual':got})
    for case in corpus['cases']:
        name=case['id']; row=actual.get(name,{})
        assertions+=1
        if row.get('error') or 'result' not in row:
            failure(name,'result','valid result',row)
            continue
        assertions+=1
        if row.get('inputUnchanged') is not True:
            failure(name,'inputUnchanged',True,row.get('inputUnchanged'))
        result=row['result']
        for field,want in expected[name].items():
            if field.startswith('_'): continue
            assertions+=1
            got=result.get(field,'<missing>')
            if isinstance(want,str) and field!='method':
                if not isinstance(got,(int,float)) or isinstance(got,bool):
                    failure(name,field,want,got);continue
                error=abs(Decimal.from_float(float(got))-Decimal(want))
                max_errors[field]=max(max_errors[field],error)
                tolerance=max(Decimal('2e-10'),abs(Decimal(want))*Decimal('3e-12'))
                if error>tolerance: failure(name,field,want,got)
            elif want!=got:
                failure(name,field,want,got)
        assertions+=1
        value=result.get('sobel')
        if value is not None and (not isinstance(value,(int,float)) or isinstance(value,bool) or not 0<=value<=100):
            failure(name,'sobelBound','null or finite [0,100]',value)
    for invariant in corpus['invariants']:
        reference=actual[invariant['case_ids'][0]]['result']
        for name in invariant['case_ids'][1:]:
            result=actual[name]['result']
            for field in ['sobelSamples','sobel','sobelMeanMagnitude','mean','histogram']:
                # Complement changes mean/histogram; symmetry preserves the
                # response and support exactly (up to summation roundoff).
                if invariant['name']=='opaque-gray-dihedral-and-complement' and field in ['mean','histogram']:
                    continue
                assertions+=1
                a,b=reference.get(field,'<missing>'),result.get(field,'<missing>')
                if isinstance(a,(int,float)) and isinstance(b,(int,float)):
                    equal=abs(a-b)<=2e-10
                else:equal=a==b
                if not equal:failure(name,'invariant-'+field,a,b)
    rms_cases=[name for name,item in expected.items() if item['_rms'] is not None and abs(Decimal(item['_rms'])-Decimal(item['sobelMeanMagnitude']))>Decimal('1e-3')]
    assert rms_cases,'Corpus must distinguish mean magnitude from RMS'
    receipt={
      'status':'PASS' if not failures else 'FAIL','module_sha256':module_sha,
      'baseline_source':module_sha==BASELINE_SHA,'input_sha256':sha(input_bytes),
      'input_storage_sha256':sha(stored_input),'input_encoding':'gzip' if compressed else 'json',
      'oracle_sha256':sha(Path(__file__).read_bytes()),'runner_sha256':sha((HERE/'runner.mjs').read_bytes()),
      'proof_sha256':sha((HERE/'proof.json').read_bytes()),'observations_sha256':sha((destination/'observations.json').read_bytes()),
      'expected_sha256':sha((destination/'expected.json').read_bytes()),
      'case_count':len(corpus['cases']),'image_count':len(corpus['images']),
      'group_counts':dict(Counter(case['group'] for case in corpus['cases'])),
      'binary_patches':512,'exact_maximum_squared':BOUND_SQUARED,'maximizers_including_free_centre':16,
      'no_support_cases':sum(item['sobelSamples']==0 for item in expected.values()),
      'real_zero_support_present_cases':sum(item['sobelSamples']>0 and Decimal(item['sobelMeanMagnitude'])==0 for item in expected.values()),
      'rms_distinguishing_cases':len(rms_cases),'assertions':assertions,
      'failure_count':len(failures),'failure_categories':dict(categories),
      'max_absolute_errors':{key:str(value) for key,value in max_errors.items()},
      'failures':failures,'proof':proof,'strict_exit_enabled':args.require_pass,
      'limitations':['Generated byte RGBA only; no optical sharpness, recognition quality, camera or field qualification.','Tolerance covers floating summation and weighted-luma arithmetic; input corpus avoids exact rational half-luma ties.','Kernel maximum proof applies to bounded rounded luma bytes; malformed non-byte raw inputs are outside this test corpus.'],
    }
    (destination/'receipt.json').write_bytes(encoded(receipt))
    print(json.dumps({key:receipt[key] for key in ['status','module_sha256','input_sha256','case_count','image_count','assertions','failure_count','failure_categories','exact_maximum_squared','maximizers_including_free_centre','no_support_cases','real_zero_support_present_cases','rms_distinguishing_cases','max_absolute_errors']},indent=2))
    if args.require_pass and failures:sys.exit(1)

if __name__=='__main__':main()
