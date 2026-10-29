const selector = { type: 'string', minLength: 1, maxLength: 1024 };
const value = { type: 'string', maxLength: 64 * 1024 };
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
export const browserInteractionDefinitions = [
  { name: 'browser_click', description: 'Click one actual DOM element by CSS selector. External pages require explicit approval.', inputSchema: schema({ selector }, ['selector']) },
  { name: 'browser_fill', description: 'Fill one actual input by CSS selector. External pages require explicit approval.', inputSchema: schema({ selector, value }, ['selector', 'value']) },
  { name: 'browser_press', description: 'Press a bounded keyboard shortcut on exactly one element. External pages require explicit approval.', inputSchema: schema({ selector, key: { type: 'string', enum: ['Enter', 'Shift+Enter', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space', 'ControlOrMeta+A'] } }, ['selector', 'key']) },
  { name: 'browser_scroll', description: 'Wheel-scroll the page or exactly one hovered element by 1–4000 pixels. External pages require explicit approval.', inputSchema: schema({ selector, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, pixels: { type: 'integer', minimum: 1, maximum: 4000 } }, ['direction', 'pixels']) },
  { name: 'browser_select', description: 'Select one option value in exactly one native select element. External pages require explicit approval.', inputSchema: schema({ selector, value }, ['selector', 'value']) },
];

// These are the deliberately small primitive schemas used by the owned tool registry.
export function validatePrimitiveArguments(definition, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) throw new Error('Tool arguments must be a plain object');
  const { properties, required } = definition.inputSchema;
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(properties, key)) throw new Error('Invalid tool argument');
    const rule = properties[key], item = args[key];
    if (rule.type === 'integer' ? !Number.isInteger(item) : typeof item !== rule.type) throw new Error('Invalid tool argument type');
    if (rule.enum && !rule.enum.includes(item)) throw new Error('Invalid tool argument choice');
    if (typeof item === 'string' && (item.length < (rule.minLength ?? 0) || item.length > (rule.maxLength ?? Infinity))) throw new Error('Tool argument exceeds limits');
    if (typeof item === 'number' && (item < rule.minimum || item > rule.maximum)) throw new Error('Tool argument exceeds limits');
  }
  for (const key of required) if (!Object.hasOwn(args, key)) throw new Error(`Missing argument: ${key}`);
}

export async function performBrowserInteraction(page, name, args) {
  let locator;
  if (args.selector !== undefined) {
    locator = page.locator(args.selector);
    if (await locator.count() !== 1) throw new Error('Browser selector must match exactly one element');
  }
  if (name === 'browser_click') await locator.click();
  else if (name === 'browser_fill') await locator.fill(args.value);
  else if (name === 'browser_press') await locator.press(args.key);
  else if (name === 'browser_select') await locator.selectOption({ value: args.value });
  else if (name === 'browser_scroll') {
    if (locator) await locator.hover();
    else {
      const viewport = page.viewportSize();
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
    }
    const amount = ['up', 'left'].includes(args.direction) ? -args.pixels : args.pixels;
    await page.mouse.wheel(['left', 'right'].includes(args.direction) ? amount : 0, ['up', 'down'].includes(args.direction) ? amount : 0);
  }
}
