import { randomUUID } from 'node:crypto';

const specs = [
  ['list_notes', 'List saved notes.', {}],
  ['save_note', 'Save a note after human approval.', { text: { type: 'string' } }],
  ['list_tasks', 'List all tasks and their completion status.', {}],
  ['add_task', 'Add a task after human approval.', { title: { type: 'string' } }],
  ['complete_task', 'Complete an existing task after human approval.', { id: { type: 'string' } }],
];
export const definitions = specs.map(([name, description, properties]) => ({
  type: 'function', function: { name, description, parameters: {
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
  } },
}));

export function createTools(store, approve = async () => false) {
  return async (name, args = {}) => {
    const spec = specs.find(([candidate]) => candidate === name);
    if (!spec) throw new Error(`Unknown tool: ${name}`);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object');
    const keys = Object.keys(spec[2]);
    if (Object.keys(args).some(key => !keys.includes(key))) throw new Error('Unexpected argument');
    for (const key of keys) {
      if (typeof args[key] !== 'string' || !args[key].trim() || args[key].length > 4000) {
        throw new Error(`${key} must contain 1–4000 characters`);
      }
    }
    const state = await store.load();
    if (name === 'list_notes') return state.notes;
    if (name === 'list_tasks') return state.tasks;
    const task = name === 'complete_task' ? state.tasks.find(item => item.id === args.id) : null;
    if (name === 'complete_task' && !task) throw new Error('Task not found');
    if (!await approve(name, args)) return { status: 'denied', message: 'The user declined. No data changed.' };
    let result;
    if (name === 'save_note') {
      result = { id: randomUUID(), text: args.text.trim(), createdAt: new Date().toISOString() };
      state.notes.push(result);
    } else if (name === 'add_task') {
      result = { id: randomUUID(), title: args.title.trim(), done: false, createdAt: new Date().toISOString() };
      state.tasks.push(result);
    } else { task.done = true; result = task; }
    await store.save(state);
    return result;
  };
}
