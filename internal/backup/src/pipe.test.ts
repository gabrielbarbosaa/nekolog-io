import { describe, expect, it } from 'vitest'
import type { Command } from './commands.ts'
import { PipelineFailed, runPipeline } from './pipe.ts'

function node(script: string, env: Record<string, string> = {}): Command {
  return { file: process.execPath, args: ['-e', script], env }
}

const READ_ALL =
  "let b='';process.stdin.setEncoding('utf8');" +
  "process.stdin.on('data',c=>{b+=c});process.stdin.on('end',()=>{"

describe('running a pipeline of real processes', () => {
  it('hands each stage the one before it, and returns the last stdout', async () => {
    const result = await runPipeline([
      node("process.stdout.write('hello')"),
      node(`${READ_ALL}process.stdout.write(b.toUpperCase())})`),
    ])

    expect(result.stdout).toBe('HELLO')
  })

  it('ends the first stdin, so a stage that reads input does not hang', async () => {
    const result = await runPipeline([node(`${READ_ALL}process.stdout.write('['+b+']')})`)])

    expect(result.stdout).toBe('[]')
  }, 15_000)

  it('fails naming the stage and quoting what it wrote to stderr', async () => {
    const failing = runPipeline([
      node("process.stderr.write('could not connect');process.exit(3)"),
      node(`${READ_ALL}process.stdout.write(b)})`),
    ])

    await expect(failing).rejects.toBeInstanceOf(PipelineFailed)
    await expect(failing).rejects.toThrow(/exited 3: could not connect/)
  })

  it('fails when a stage in the middle is the broken one', async () => {
    const failing = runPipeline([
      node("process.stdout.write('x')"),
      node("process.stderr.write('bad gzip');process.exit(1)"),
      node(`${READ_ALL}process.stdout.write(b)})`),
    ])

    await expect(failing).rejects.toThrow(/bad gzip/)
  })

  it('fails instead of hanging when the binary is not installed', async () => {
    const failing = runPipeline([{ file: 'nekolog-no-such-binary', args: [], env: {} }])

    await expect(failing).rejects.toThrow(/nekolog-no-such-binary/)
  }, 15_000)

  it('refuses an empty pipeline rather than reporting success for doing nothing', async () => {
    await expect(runPipeline([])).rejects.toThrow(/nothing to run/)
  })

  it('gives each stage its own environment and leaks neither way', async () => {
    const result = await runPipeline([
      node(
        "process.stdout.write(String(process.env.ONLY_FIRST)+'|'+String(process.env.ONLY_LAST))",
        {
          ONLY_FIRST: 'yes',
        },
      ),
      node(
        `${READ_ALL}process.stdout.write(b+' then '+String(process.env.ONLY_FIRST)+'|'+String(process.env.ONLY_LAST))})`,
        { ONLY_LAST: 'yes' },
      ),
    ])

    expect(result.stdout).toBe('yes|undefined then undefined|yes')
  })

  it('carries megabytes through without deadlocking on backpressure', async () => {
    const result = await runPipeline([
      node("for(let i=0;i<4096;i++){process.stdout.write('x'.repeat(1024))}"),
      node(`${READ_ALL}process.stdout.write(String(b.length))})`),
    ])

    expect(result.stdout).toBe(String(4096 * 1024))
  }, 30_000)

  it('kills the chain when the caller gives up', async () => {
    const controller = new AbortController()
    const failing = runPipeline([node('setTimeout(()=>{}, 60000)')], {
      signal: controller.signal,
    })

    setTimeout(() => controller.abort(), 100)
    await expect(failing).rejects.toBeInstanceOf(PipelineFailed)
  }, 15_000)
})
