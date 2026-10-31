export function recognitionFixture(source = 'a'.repeat(64)) {
  const events = [{ id: 'fixture-observation', camera: 'test-recording', label: 'person', score: .9, seconds: 0, started_seconds: 0, rule: 'person present in entry for 0s', review_required: true }];
  const common = {
    source_sha256: source, model_sha256: 'b'.repeat(64), labels_sha256: 'c'.repeat(64), rules_sha256: 'd'.repeat(64), rules_file_sha256: 'e'.repeat(64),
    camera: 'test-recording', inference_profile: 'yolov8-raw-640', state: 'completed', frames_read: 6, fps_metadata: 10, stride: 5, events,
  };
  return { schema: 'intelligent-dvr.recognition-review.v1',
    receipt: { ...common, schema: 'intelligent-dvr.receipt.v1', mode: 'offline-model', frames_analyzed: 2, runtime: { backend_id: 'opencv-cpu' } },
    trace: { ...common, schema: 'intelligent-dvr.detection-trace.v1', origin: 'offline-analyzer', frames: [
      { frame_index: 0, seconds: 0, width: 320, height: 240, detections: [
        { label: 'person', score: .9, box: [.1,.2,.2,.5] },
        { label: 'car', score: .6, box: [.4,.4,.2,.2] },
        { label: 'person', score: .2, box: [.7,.2,.1,.5] },
      ] },
      { frame_index: 5, seconds: .5, width: 320, height: 240, detections: [] },
    ] },
  };
}

export function sharpeningFixture(source) {
  const value=recognitionFixture(source);
  const declaration={schema:'intelligent-dvr.enhancement-comparison.v1',profile:'mild-unsharp-v1',
    parameters:{kernel_size:5,sigma:1,amount:.5,threshold:3,border:'reflect-101',scale:1},
    implementation_sha256:'f'.repeat(64),qualification:'unqualified',rule_observations:'original-only'};
  value.receipt.enhancement_comparison=structuredClone(declaration);
  value.trace.enhancement_comparison=structuredClone(declaration);
  for(const f of value.trace.frames) f.comparison={detections:[],original_processing_ms:10,
    enhanced_processing_ms:14,enhancement_ms:2,source_pixels_sha256:'1'.repeat(64),enhanced_pixels_sha256:'2'.repeat(64)};
  value.trace.frames[1].comparison.detections=[{label:'truck',score:.8,box:[.1,.2,.2,.3]}];
  return value;
}
