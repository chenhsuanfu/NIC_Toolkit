/**
 * Modular Tool Registry (Supports Built-in Native Modules & External Portals)
 */
class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(toolDef) {
    if (!toolDef || !toolDef.id) {
      throw new Error('Tool definition requires a valid id');
    }
    this.tools.set(toolDef.id, toolDef);
  }

  get(id) {
    return this.tools.get(id);
  }

  listAll() {
    return Array.from(this.tools.values()).sort((a, b) => (a.order || 99) - (b.order || 99));
  }
}

export const registry = new ToolRegistry();
