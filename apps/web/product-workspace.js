import { createIdentitySurface } from './product-identity.js';
import { createTeamSurface } from './product-team.js';
import { createOnboardingSurface } from './product-onboarding.js';
import { createDocumentSurface } from './product-documents.js';
import { createComputerSurface } from './product-computer.js';
import { createConnectorSurface } from './product-connectors.js';

/** Real product leaves. Each leaf owns its pending work and never runs shipped code. */
export function createWorkspaceSurface(host) {
  const leaves = [createIdentitySurface(host), createTeamSurface(host), createOnboardingSurface(host),
    createDocumentSurface(host), createComputerSurface(host), createConnectorSurface(host)];
  return {
    id: 'workspace',
    afterRender(context) { for (const leaf of leaves) leaf.afterRender?.(context); },
    beforeRender(context) { for (const leaf of leaves) leaf.beforeRender?.(context); },
    beforeDialogChange(context) { for (const leaf of leaves) leaf.beforeDialogChange?.(context); },
    afterDialogChange(context) { for (const leaf of leaves) leaf.afterDialogChange?.(context); },
    renderSlot(name, context) { for (const leaf of leaves) { const result = leaf.renderSlot?.(name, context); if (result !== undefined) return result; } },
    handleAction(context) { for (const leaf of leaves) { const result=leaf.handleAction?.(context); if (result) return result; } return false; },
    handleSubmit(context) { for (const leaf of leaves) { const result=leaf.handleSubmit?.(context); if (result) return result; } return false; },
    handleInput(event) { for (const leaf of leaves) leaf.handleInput?.(event); },
    handleChange(event) { for (const leaf of leaves) leaf.handleChange?.(event); },
    setInspect(value){for(const leaf of leaves)leaf.setInspect?.(value);for(const animation of host.overlay.getAnimations({subtree:true})){if(!String(animation.id).startsWith('ui-motion:team'))continue;if(value)animation.pause();else if(animation.playState==='paused')animation.play();}},
    setReducedMotion(value){for(const leaf of leaves)leaf.setReducedMotion?.(value);if(value)for(const animation of host.overlay.getAnimations({subtree:true})){if(/^ui-motion:team(?:Resize|Retire|Pin)/.test(String(animation.id)))animation.cancel();}},
    destroy() { for (const leaf of leaves) leaf.destroy?.(); },
  };
}

export const source = number => `data-source-instance="INSTANCE-${String(number).padStart(3, '0')}"`;
export const actionButton = (label, action, extra = '') => `<button type="button" class="outline-button" data-action="${action}" ${extra}>${label}</button>`;
