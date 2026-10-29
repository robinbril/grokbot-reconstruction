import { CANONICAL_SHAPES, REST_ROTATION, renderAvatarFrame } from './avatar-math.js';
// Inert source Gv/Vxe constants: 36px character, 3px contour gap, 1px ring.
// The independent local renderer supplies the character path; no target JS runs.
export function selectionContour(shape, key) {
  const name=CANONICAL_SHAPES[shape]||'blob',body=renderAvatarFrame({shape:name,rotation:REST_ROTATION}).body;
  const id=`product-shape-ring-${key}-${shape}`,gap=3/36*100,outer=4/36*100;
  return `<svg class="product-shape-contour" viewBox="${-outer} ${-outer} ${100+2*outer} ${100+2*outer}" aria-hidden="true"><defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${-outer}" y="${-outer}" width="${100+2*outer}" height="${100+2*outer}"><path d="${body}" fill="white" stroke="white" stroke-width="${2*outer}"/><path d="${body}" fill="black" stroke="black" stroke-width="${2*gap}"/></mask></defs><rect x="${-outer}" y="${-outer}" width="${100+2*outer}" height="${100+2*outer}" fill="currentColor" mask="url(#${id})"/></svg>`;
}
export function characterSwatch(value,index) {
  if(index===0)return 'light-dark(#000000,#ffffff)';
  if(index===10)return 'light-dark(#959595,#777777)';
  const tokens=['','brown','red','orange','yellow','green','cyan','blue','purple','magenta'];
  return `var(--sand-bg-${tokens[index]}-bright,${value})`;
}
