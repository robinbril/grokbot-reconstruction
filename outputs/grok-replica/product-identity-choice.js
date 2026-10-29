// Independent FNV-1a, avalanche and seeded-palette derivation from the pinned
// inert 0.71.2 identity contract. UUID is generated for each fresh create form.
export const CREATE_COLORS = ['#000000','#936439','#ff263c','#ff6700','#ff9800','#00c972','#00bca6','#1084fe','#9159fe','#ff309b','#777777'];
export function createIdentityChoice(id) {
  let hash=0x811c9dc5;for(const character of id){hash=Math.imul(hash^character.charCodeAt(0),0x01000193);}
  const base=hash>>>0;let mixed=Math.imul(base^(base>>>16),73244475);mixed=Math.imul(mixed^(mixed>>>13),3266489909);const shape=((mixed^(mixed>>>16))>>>0)%13;
  // Version1 color salts cancel because the seed builder and palette chooser
  // apply the same XOR salt. One Mulberry32 sample selects non-black colors.
  let seed=(base+1831565813)|0, value=Math.imul(seed^(seed>>>15),1|seed);value^=value+Math.imul(value^(value>>>7),61|value);
  const fraction=((value^(value>>>14))>>>0)/4294967296;
  return {shape,color:CREATE_COLORS[1+Math.floor(fraction*10)]};
}
