import React,{useEffect,useRef,useState} from 'react';
import {displayLength,enteredLength,unitLabel} from './facility-shape-edit.mjs';

export default function LengthInput({title,value,units,onChange}) {
  const shown=String(displayLength(value,units) ?? ''), last=useRef(value);
  const [text,setText]=useState(shown);
  useEffect(()=>{last.current=value;setText(shown);},[units]);
  useEffect(()=>{if(!Object.is(value,last.current)){last.current=value;setText(shown);}},[value,shown]);
  return <label className="room-length"><span>{title} <small>{unitLabel(units)}</small></span>
    <input type="number" step="any" min="0" aria-label={title} value={text} onChange={e=>{
      const raw=e.target.value;setText(raw);
      const next=raw===''?'':enteredLength(raw,value,units);last.current=next;onChange(next);
    }}/></label>;
}
