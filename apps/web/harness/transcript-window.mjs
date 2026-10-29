import {activeStatuses} from './store.mjs';
export function transcriptWindowContext(state,entries){
 const entryIds=new Set(entries.map(entry=>entry.id)),runIds=new Set(entries.map(entry=>entry.runId).filter(Boolean));
 const runs=state.runs.filter(run=>runIds.has(run.id)||entryIds.has(run.inputEntryId)||entryIds.has(run.outputEntryId)||activeStatuses.has(run.status));
 for(const run of runs)runIds.add(run.id);
 return {runs,tools:state.tools.filter(tool=>runIds.has(tool.runId))};
}
