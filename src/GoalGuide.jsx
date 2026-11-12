import React from 'react';
import { ArrowRight, Buildings, Camera, FileVideo, HardDrives } from '@phosphor-icons/react';
import { GOAL_GUIDE_TASKS } from './goal-guide.mjs';
import './goal-guide.css';

const icons = { watch: Camera, recording: FileVideo, backup: HardDrives, facility: Buildings };

export default function GoalGuide({ onChoose }) {
  return <section className="goal-guide" aria-labelledby="goal-guide-heading">
    <div className="goal-guide-heading"><p className="eyebrow">START WITH A GOAL</p><h2 id="goal-guide-heading">What’s next?</h2><p>Choose a task. You stay in control.</p></div>
    <div className="goal-guide-actions" role="group" aria-label="Choose your next task">
      {GOAL_GUIDE_TASKS.map(task => {
        const Icon = icons[task.id];
        return <button type="button" key={task.id} onClick={() => onChoose(task)}>
          <Icon size={21} aria-hidden="true" /><span><strong>{task.goalTitle}</strong><small>{task.goalDetail}</small></span><ArrowRight size={15} aria-hidden="true" />
        </button>;
      })}
    </div>
  </section>;
}
