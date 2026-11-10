import {analysisRequest, importRecording} from './local-analysis.mjs';

// These native validation/quality responses occur before a template write.
// A server error can follow a committed write; it never authorizes a retry.
export const personWriteRefused = error => [400, 404, 409, 413, 415, 422].includes(error?.status);

// Importing a clip is separate from changing a face template. Leaving during
// the import must never submit the later enrollment or refinement operation.
export async function submitPersonRecording({clip, service, person = null, name = '', signal,
  onSubmit, fetcher = fetch, importer = importRecording}) {
  signal?.throwIfAborted();
  const file = new File([clip.blob], clip.name, {type:clip.blob.type});
  const imported = await importer(file, service.token, signal, fetcher);
  signal?.throwIfAborted();
  const path = person ? `/people/${person.id}/verify` : '/people';
  const body = person ? {recording:imported.recording.id} : {
    name:name.trim(), consent:{confirmed:true, statement:service.people.statement}, recording:imported.recording.id,
  };
  onSubmit?.();
  signal?.throwIfAborted();
  const response = await analysisRequest(path, {token:service.token, method:'POST', body, signal, fetcher});
  const result = await response.json();
  signal?.throwIfAborted();
  if (!/^[a-f0-9]{16}$/.test(result?.person?.id) || typeof result.person.name !== 'string' ||
      !result.person.name.trim() || !Number.isSafeInteger(result.person.views) || result.person.views < 0 ||
      (person && result.person.id !== person.id)) throw Error('The local template reply could not be verified.');
  return result;
}
