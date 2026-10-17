import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { createTools } from '../src/tools.js';
import { Agent, ollamaProvider } from '../src/agent.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new Store(directory);
}
test('approved tasks persist across store instances and can be completed', async t => {
  const store = await fixture(t);
  const execute = createTools(store, async () => true);
  const task = await execute('add_task', { title: 'Ship it' });
  await execute('complete_task', { id: task.id });
  assert.equal((await new Store(store.directory).load()).tasks[0].done, true);
});
test('denied writes leave persistent state unchanged', async t => {
  const store = await fixture(t);
  const execute = createTools(store);
  assert.equal((await execute('save_note', { text: 'Private' })).status, 'denied');
  assert.deepEqual(await store.load(), { notes: [], tasks: [] });
});
test('invalid tool arguments and unknown tools never request approval', async t => {
  let approvals = 0;
  const execute = createTools(await fixture(t), async () => { approvals++; return true; });
  await assert.rejects(execute('run_shell', {}), /Unknown tool/);
  await assert.rejects(execute('save_note', { text: '' }), /characters/);
  await assert.rejects(execute('add_task', { title: 'ok', path: '../x' }), /Unexpected/);
  await assert.rejects(execute('complete_task', { id: 'missing' }), /not found/);
  assert.equal(approvals, 0);
});
test('notes survive reload and malformed state is not overwritten', async t => {
  const store = await fixture(t);
  await createTools(store, async () => true)('save_note', { text: 'Tea over coffee' });
  assert.equal((await new Store(store.directory).load()).notes[0].text, 'Tea over coffee');
  const file = join(store.directory, 'state.json');
  await writeFile(file, 'broken');
  await assert.rejects(createTools(store, async () => true)('add_task', { title: 'x' }));
  assert.equal(await readFile(file, 'utf8'), 'broken');
});
test('agent feeds actual tool results back to the provider', async t => {
  let step = 0;
  const agent = new Agent({ execute: createTools(await fixture(t), async () => true), provider: async messages => {
    if (step++ === 0) return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'add_task', arguments: { title: 'Test' } } }] };
    assert.equal(messages.at(-1).role, 'tool');
    assert.equal(JSON.parse(messages.at(-1).content).title, 'Test');
    return { role: 'assistant', content: 'Done' };
  } });
  assert.equal(await agent.run('Add a task'), 'Done');
});
test('tool failures become model-visible errors', async () => {
  let step = 0;
  const agent = new Agent({ execute: async () => { throw new Error('denied path'); }, provider: async messages => {
    if (step++ === 0) return { role: 'assistant', tool_calls: [{ function: { name: 'bad', arguments: {} } }] };
    assert.equal(JSON.parse(messages.at(-1).content).error, 'denied path');
    return { role: 'assistant', content: 'Could not complete' };
  } });
  assert.equal(await agent.run('Try'), 'Could not complete');
});
test('agent stops repeated tool calls at the step limit', async () => {
  let calls = 0;
  const agent = new Agent({ maxSteps: 2, execute: async () => { calls++; return []; }, provider: async () => ({
    role: 'assistant', tool_calls: [{ function: { name: 'list_tasks', arguments: {} } }],
  }) });
  await assert.rejects(agent.run('loop'), /Stopped after 2/);
  assert.equal(calls, 2);
});
test('Ollama adapter sends tools and handles HTTP failures', async () => {
  const provider = ollamaProvider({ fetchFn: async (url, options) => {
    assert.equal(url.pathname, '/api/chat');
    const body = JSON.parse(options.body);
    assert.equal(body.stream, false);
    assert.equal(body.tools.length, 5);
    return { ok: true, json: async () => ({ message: { role: 'assistant', content: 'Hello' } }) };
  } });
  assert.equal((await provider([])).content, 'Hello');
  await assert.rejects(ollamaProvider({ fetchFn: async () => ({ ok: false, status: 404 }) })([]), /HTTP 404/);
});
