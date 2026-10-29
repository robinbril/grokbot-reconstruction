import {createGrokModel} from './grok-model.mjs';
import {createClaudeSeatModel} from './claude-seat-model.mjs';
import {harnessError} from './store.mjs';

// Provider choice is explicit. A failed provider never silently switches accounts.
export function createModelProvider({env=process.env}={}){
 const provider=env.GROK_MODEL_PROVIDER??'xai';
 if(provider==='xai')return createGrokModel({env});
 if(provider==='claude-seat')return createClaudeSeatModel({env});
 throw harnessError('MODEL_PROVIDER_INVALID','GROK_MODEL_PROVIDER must be xai or claude-seat',503);
}
