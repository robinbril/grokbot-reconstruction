/** One source-named scheduler for both real time and inspect-only deterministic
 * advancement. The inspector changes this scheduler's clock, never a mock model. */
export function createOnboardingClock(inspect=false){
 let elapsed=0,anchor=performance.now(),timer=null,disposed=false,sequence=0;const tasks=new Map();
 function next(){return [...tasks.values()].sort((a,b)=>a.due-b.due||a.sequence-b.sequence)[0];}
 function flush(target){if(disposed)return;let iterations=0;while(next()?.due<=target){if(++iterations>100000)throw new RangeError('Onboarding clock event limit');const task=next();elapsed=task.due;if(task.interval)task.due+=task.interval;else tasks.delete(task.name);task.run();}elapsed=target;}
 function arm(){clearTimeout(timer);timer=null;if(disposed||inspect||!tasks.size)return;const due=next().due;timer=setTimeout(()=>{timer=null;flush(Math.max(elapsed,performance.now()-anchor));arm();},Math.max(0,due-elapsed));}
 return {
  get elapsed(){return elapsed;},get pending(){return tasks.size;},get inspect(){return inspect;},
  schedule(name,delay,run,interval=0){if(disposed)return;tasks.set(name,{name,due:elapsed+delay,run,interval,sequence:sequence++});arm();},
  cancel(name){tasks.delete(name);arm();},cancelPrefix(prefix){for(const key of tasks.keys())if(key.startsWith(prefix))tasks.delete(key);arm();},
  advance(ms){if(!inspect)throw new Error('Clock advancement requires the motion inspector');if(!Number.isFinite(ms)||ms<0||ms>3600000)throw new RangeError('Invalid clock advancement');flush(elapsed+ms);arm();},
  setInspect(value){const chosen=Boolean(value);if(chosen===inspect)return;if(!inspect)flush(Math.max(elapsed,performance.now()-anchor));inspect=chosen;anchor=performance.now()-elapsed;arm();},
  snapshot(){return [...tasks.values()].map(({name,due,interval})=>({name,dueMs:due,intervalMs:interval}));},
  destroy(){disposed=true;clearTimeout(timer);timer=null;tasks.clear();},
 };
}
