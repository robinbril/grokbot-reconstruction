import {jsx,jsxs,Fragment} from 'react/jsx-runtime';
import {annotateCanvasElement} from 'canvas-design';
export {Fragment};
// jsxDEV supplies real opening-tag coordinates; production React remains in use.
// No component or ref is wrapped, and no callback/property lifecycle is replaced.
export function jsxDEV(type,props,key,staticChildren,source){
 return (staticChildren?jsxs:jsx)(type,annotateCanvasElement(type,props,source),key);
}
