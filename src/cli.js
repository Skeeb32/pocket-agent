import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { createTools } from './tools.js';
import { Agent, ollamaProvider } from './agent.js';

// Escape terminal control sequences in model text and approval previews.
const display = value => String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
async function demo() {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-demo-'));
  let step = 0;
  const responses = [
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'add_task', arguments: { title: 'Try Pocket Agent' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_tasks', arguments: {} } }] },
    { role: 'assistant', content: 'Created your task: Try Pocket Agent. It is not completed yet.' },
  ];
  try {
    const agent = new Agent({
      provider: async () => responses[step++],
      execute: createTools(new Store(directory), async () => true),
      onTool: name => console.log(`  tool → ${name}`),
    });
    console.log('Pocket Agent demo — scripted model, temporary data, no network.');
    console.log(await agent.run('Add a task to try Pocket Agent, then show my tasks.'));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function main() {
  if (process.argv.includes('--demo')) return demo();
  const terminal = createInterface({ input: stdin, output: stdout });
  const execute = createTools(new Store(process.env.POCKET_DATA_DIR || '.pocket-agent'), async (name, args) => {
    if (!stdin.isTTY) return false;
    const reply = await terminal.question(`\nApprove ${name} ${display(JSON.stringify(args))}? [y/N] `);
    return reply.trim().toLowerCase() === 'y';
  });
  const agent = new Agent({ provider: ollamaProvider({ host: process.env.OLLAMA_HOST, model: process.env.OLLAMA_MODEL }), execute,
    onTool: name => console.log(`  tool → ${display(name)}`) });
  console.log('Pocket Agent · notes + tasks · /exit to quit');
  try {
    while (true) {
      const input = (await terminal.question('\nYou › ')).trim();
      if (input === '/exit') break;
      if (!input) continue;
      try { console.log(`\nPocket › ${display(await agent.run(input))}`); }
      catch (error) { console.error(`Error: ${display(error.message)}`); }
    }
  } finally { terminal.close(); }
}
main().catch(error => { console.error(display(error.message)); process.exitCode = 1; });
