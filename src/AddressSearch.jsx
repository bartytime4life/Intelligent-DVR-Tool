import React, { useEffect, useRef, useState } from 'react';
import { GEOCODERS, searchPlaces } from './facility-services.mjs';

// focusSignal: each increase opens the search and focuses the address field.
export function AddressSearch({ onChoose, focusSignal = 0, initiallyOpen = false }) {
  const [query,setQuery] = useState(''), [provider,setProvider] = useState('public');
  const [results,setResults] = useState([]), [message,setMessage] = useState(''), [busy,setBusy] = useState(false);
  const request = useRef(), generation = useRef(0), resultHeading = useRef(), details = useRef(), field = useRef(), startOpen = useRef(initiallyOpen), handledFocus = useRef(focusSignal);
  // Only a request made while this search is shown moves focus; remounting with an old signal does not.
  useEffect(() => { if (focusSignal === handledFocus.current) return; handledFocus.current = focusSignal; details.current.open = true; field.current?.focus(); }, [focusSignal]);
  function invalidate() { generation.current++; request.current?.abort(); setBusy(false); setResults([]); setMessage(''); }
  useEffect(()=>()=>{ generation.current++; request.current?.abort(); },[]);
  async function search(e) {
    e.preventDefault();
    invalidate();
    const token = generation.current, c = new AbortController(); request.current = c;
    setBusy(true); setMessage('Searching places…');
    try {
      const places = await searchPlaces(query,provider,c.signal);
      if (token!==generation.current) return;
      setResults(places); setMessage(places.length ? `${places.length} suggestions. Choose one, then review coordinates before saving.` : 'No matches. Add a city or use coordinates, GPS, or a saved extract.');
      requestAnimationFrame(()=>resultHeading.current?.focus());
    } catch(e) { if(token===generation.current) setMessage(e.name==='TimeoutError' ? 'Address service timed out. Use coordinates or try later.' : e.name==='TypeError' ? 'Could not reach the address service. Use coordinates, GPS, or try a local service.' : e.message); }
    finally { if(token===generation.current) setBusy(false); }
  }
  return <details ref={details} open={startOpen.current} className="facility-starter" onToggle={e=>{if(e.target===e.currentTarget && !e.currentTarget.open)invalidate();}}><summary>Find an address or place</summary>
    <form onSubmit={search}>
      <label className="facility-field"><span>Address search provider</span><select aria-label="Address search provider" value={provider} onChange={e=>{invalidate();setProvider(e.target.value);}}>{GEOCODERS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <p className="facility-caption">Search sends only the submitted text to {provider==='public' ? 'photon.komoot.io (public demo; availability varies)' : `this site’s ${GEOCODERS.find(p=>p.id===provider).url} service (operator must configure it)`}. No device position, camera plan or recordings are sent. Nothing is sent while typing. Avoid private addresses on public services.</p>
      <label className="facility-field"><span>Address or place name</span><input ref={field} type="search" aria-label="Address or place name" placeholder="e.g. 1200 Main St, Springfield" autoComplete="off" minLength={3} maxLength={180} required value={query} onChange={e=>{invalidate();setQuery(e.target.value);}} /></label>
      <button className="facility-primary" disabled={busy || query.trim().length<3}>Search address</button>
      {busy && <button className="facility-secondary" type="button" onClick={()=>{invalidate();setMessage('Search cancelled.');}}>Cancel address search</button>}
    </form>
    <p className="facility-caption" role="status" tabIndex={-1} ref={resultHeading}>{message}</p>
    <ul className="facility-place-results" aria-label="Address suggestions">{results.map((p,i)=><li key={i}><button type="button" className="facility-secondary" onClick={()=>{onChoose(p);invalidate();setMessage('Location suggestion selected. Review and save the site below.');}}>{p.label}<small>{p.origin[1].toFixed(6)}, {p.origin[0].toFixed(6)}</small></button></li>)}</ul>
    <p className="facility-caption">Search locates a place, not a surveyed building boundary. © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a> · <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Photon terms</a></p>
  </details>;
}
