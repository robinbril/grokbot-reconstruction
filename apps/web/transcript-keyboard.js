// Shipped transcript End route (0.71.2 J12); mounted on the transcript, never globally.
export function handleTranscriptEnd(event,scrollToBottom){
 if(event.key!=='End'||event.shiftKey||event.altKey)return false;
 const target=event.target;
 if(target instanceof HTMLElement&&(target.isContentEditable||target.tagName==='INPUT'||target.tagName==='TEXTAREA'))return false;
 event.preventDefault();scrollToBottom();return true;
}
