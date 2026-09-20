// Test-only Wails host: memory-backed metadata, never an upstream API.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useStudio} from '../../src/studio/useStudio';
import {emptySnapshot, type Project} from '../../src/studio/types';

const stored = new Map<string, Project>();
const control = {
  staleSnapshot: false,
  fail: false,
  holdNext: false,
  release: undefined as undefined | (() => void),
  writes: [] as Project[],
  stored,
};
Object.assign(window, {
  __saveControl: control,
  go: {backend: {StudioV2: {
    async GetSnapshot() {
      return {...emptySnapshot(), projects: control.staleSnapshot ? [] : structuredClone([...stored.values()])};
    },
    async SaveProject(project: Project) {
      control.writes.push(structuredClone(project));
      if (control.holdNext) {
        control.holdNext = false;
        await new Promise<void>(resolve => {control.release = resolve;});
        control.release = undefined;
      }
      if (control.fail) throw Error('模拟磁盘写入失败');
      const old = stored.get(project.id);
      if ((old?.revision ?? 0) !== project.revision) throw Error('revision conflict');
      const saved = {...structuredClone(project), revision: project.revision + 1, updatedAt: new Date().toISOString()};
      stored.set(saved.id, saved);
      return structuredClone(saved);
    },
  }}},
});
function Harness() {
  const studio = useStudio();
  Object.assign(window, {__studio: studio});
  return <div>Draft persistence test</div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);
