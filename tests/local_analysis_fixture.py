"""Generated pixels and constant ONNX boxes: integration fixtures, never accuracy."""
import argparse
import hashlib
import json
from pathlib import Path


def build(root):
    import cv2
    import numpy as np
    import onnx
    from onnx import helper, TensorProto, numpy_helper
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    recordings = root / 'recordings'; recordings.mkdir(exist_ok=True)
    nodes = [helper.make_node('GlobalAveragePool', ['image'], ['pooled']),
             helper.make_node('Flatten', ['pooled'], ['flat']),
             helper.make_node('Gemm', ['flat', 'weights', 'bias'], ['row'], transB=1),
             helper.make_node('Reshape', ['row', 'shape'], ['detections'])]
    initializers = [numpy_helper.from_array(np.zeros((5, 3), dtype=np.float32), 'weights'),
                    numpy_helper.from_array(np.array([320, 320, 160, 160, .9], dtype=np.float32), 'bias'),
                    numpy_helper.from_array(np.array([1, 5, 1], dtype=np.int64), 'shape')]
    graph = helper.make_graph(nodes, 'synthetic-only',
        [helper.make_tensor_value_info('image', TensorProto.FLOAT, [1, 3, 640, 640])],
        [helper.make_tensor_value_info('detections', TensorProto.FLOAT, [1, 5, 1])], initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 11)]); model.ir_version = 7
    onnx.save(model, str(root / 'fixture.onnx'))
    # VP8 is decodable by the browser as well as the CPU analyzer.
    writer = cv2.VideoWriter(str(recordings / 'synthetic.webm'), cv2.VideoWriter_fourcc(*'VP80'), 10, (320, 240))
    if not writer.isOpened():
        raise RuntimeError('VP8 fixture encoder unavailable')
    for _ in range(30):
        writer.write(np.full((240, 320, 3), (55, 65, 35), dtype=np.uint8))
    writer.release()
    (recordings / 'invalid.mp4').write_text('not a video')
    (root / 'labels.json').write_text('["person"]')
    (root / 'rules.json').write_text('[{"name":"whole frame","label":"person","rect":[0,0,1,1],"dwell":1}]')
    (root / 'config.json').write_text(json.dumps({'models': [{'id': 'synthetic', 'name': 'Synthetic test model',
        'path': 'fixture.onnx', 'labels': 'labels.json', 'profile': 'yolov8-raw-640',
        'sha256': hashlib.sha256((root / 'fixture.onnx').read_bytes()).hexdigest()}],
        'rules': [{'id': 'presence', 'name': 'Person presence', 'path': 'rules.json'}]}))
    return root


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args().output)
