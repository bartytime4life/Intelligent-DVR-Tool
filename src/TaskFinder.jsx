import React, { useEffect, useId, useRef, useState } from 'react';
import { MagnifyingGlass, X, ArrowRight } from '@phosphor-icons/react';
import { findWorkspaceTasks } from './workspace-tasks.mjs';
import { backdropDismiss } from './dialog-dismiss.mjs';
import './task-finder.css';

export default function TaskFinder({ onChoose, onClose }) {
  const dialog = useRef(), input = useRef(), previousFocus = useRef(document.activeElement);
  const prefix = useId();
  const [query,setQuery] = useState(''), [selected,setSelected] = useState(0);
  const results = findWorkspaceTasks(query);
  const active = results[Math.min(selected,results.length-1)];
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    input.current.focus();
    return () => {
      element.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  },[]);
  useEffect(() => {
    if (active) document.getElementById(`${prefix}-${active.id}`)?.scrollIntoView({block:'nearest'});
  },[active?.id,prefix]);
  const choose = task => {
    if (!task) return;
    if (onChoose(task)) onClose();
    else input.current?.focus();
  };
  function keydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length) setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
  }
  return <dialog ref={dialog} className="task-finder" aria-labelledby={`${prefix}-title`} onCancel={onClose} {...backdropDismiss(onClose)}>
    <div className="task-finder-heading">
      <div><p className="eyebrow">YOUR NEXT STEP</p><h2 id={`${prefix}-title`}>Find a task</h2></div>
      <button className="icon-button" aria-label="Close task finder" onClick={onClose}><X /></button>
    </div>
    <div className="task-finder-search"><MagnifyingGlass size={22} aria-hidden="true" />
      <input ref={input} type="text" role="combobox" aria-label="Search tasks" aria-expanded="true" aria-autocomplete="list" aria-controls={`${prefix}-results`} aria-activedescendant={active ? `${prefix}-${active.id}` : undefined}
        placeholder="Try video, camera, notes, GPU…" value={query} maxLength={160} autoComplete="off" onChange={event => {setQuery(event.target.value);setSelected(0);}} onKeyDown={keydown} />
      {query && <button className="icon-button" aria-label="Clear task search" onClick={() => {setQuery('');setSelected(0);input.current.focus();}}><X size={16} /></button>}
    </div>
    <p className="sr-only" role="status">{results.length} {results.length === 1 ? 'task' : 'tasks'} found</p>
    <div id={`${prefix}-results`} role="listbox" aria-label="Tasks" className="task-finder-results">
      {results.map((task,index) => <div key={task.id}>
        {results[index-1]?.group !== task.group && <div className="task-finder-group" role="presentation">{task.group}</div>}
        <button id={`${prefix}-${task.id}`} role="option" aria-selected={active?.id === task.id} tabIndex={-1} className={`task-finder-result ${active?.id === task.id ? 'selected' : ''}`} onClick={() => choose(task)}>
          <span><strong>{task.title}</strong><span className="task-finder-detail">{task.detail}</span></span>
          <span className="task-finder-destination">{task.workspace}<ArrowRight size={16} aria-hidden="true" /></span>
        </button>
      </div>)}
    </div>
    {!results.length && <div className="task-finder-empty"><strong>No matching tasks</strong><p>Try a shorter phrase, such as “video”, “notes” or “storage”.</p><button className="text-button" onClick={() => {setQuery('');setSelected(0);input.current.focus();}}>Show all tasks</button></div>}
    <div className="task-finder-footer"><span>Opens the workspace. You choose when cameras and analysis start.</span><span className="task-finder-keys">↑ ↓ choose · Enter open · Esc close</span></div>
  </dialog>;
}
