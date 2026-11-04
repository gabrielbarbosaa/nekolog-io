import { expect, describe as explain, it } from 'vitest'
import { chooseFlavour, choosePackageManager, installCommand } from './detect.ts'
import { entriesFor, namesIn, PLACEHOLDER_PUBLIC, PLACEHOLDER_SECRET, planEnv } from './env.ts'
import { assertKey, describe, InitRefused, init, type Workspace } from './init.ts'

type Fake = Workspace & { files: Record<string, string>; commands: string[] }

function workspace(files: Record<string, string>): Fake {
  const commands: string[] = []
  return {
    files,
    commands,
    read: (file) => Promise.resolve(files[file] ?? null),
    write: (file, contents) => {
      files[file] = contents
      return Promise.resolve()
    },
    list: () => Promise.resolve(Object.keys(files)),
  }
}

function manifest(dependencies: Record<string, string>): string {
  return JSON.stringify({ name: 'app', dependencies })
}

explain('which sdk a project needs', () => {
  it.each([
    [{ next: '16', react: '19' }, 'next', '@nekolog-io/next'],
    [{ '@nestjs/core': '12', express: '5' }, 'nestjs', '@nekolog-io/nestjs'],
    [{ fastify: '5' }, 'fastify', '@nekolog-io/fastify'],
    [{ hono: '4' }, 'hono', '@nekolog-io/hono'],
    [{ express: '5' }, 'express', '@nekolog-io/express'],
    [{ react: '19', 'react-dom': '19' }, 'react', '@nekolog-io/react'],
    [{ vite: '8' }, 'browser', '@nekolog-io/browser'],
    [{ lodash: '4' }, 'node', '@nekolog-io/node'],
  ])('reads %j as %s', (dependencies, flavour, first) => {
    const choice = chooseFlavour({ dependencies })

    expect(choice.flavour).toBe(flavour)
    expect(choice.packages[0]).toBe(first)
  })

  it('prefers next over react, because next is the outer one', () => {
    expect(chooseFlavour({ dependencies: { next: '16', react: '19' } }).flavour).toBe('next')
  })

  it('prefers nest over express, which nest runs on', () => {
    expect(chooseFlavour({ dependencies: { '@nestjs/core': '12', express: '5' } }).flavour).toBe(
      'nestjs',
    )
  })

  it('looks in devDependencies too', () => {
    expect(chooseFlavour({ devDependencies: { vite: '8' } }).flavour).toBe('browser')
  })

  it('falls back to node when there is nothing to go on', () => {
    expect(chooseFlavour(undefined).flavour).toBe('node')
    expect(chooseFlavour({}).flavour).toBe('node')
  })

  it('says why it chose', () => {
    expect(chooseFlavour({ dependencies: { hono: '4' } }).because).toContain('hono')
  })
})

explain('which package manager to use', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lock', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ])('reads %s as %s', (lockfile, manager) => {
    expect(choosePackageManager(['package.json', lockfile])).toBe(manager)
  })

  it('falls back to npm when there is no lockfile', () => {
    expect(choosePackageManager(['package.json'])).toBe('npm')
  })

  it('builds the command each one understands', () => {
    expect(installCommand('pnpm', ['a'])).toEqual({ file: 'pnpm', args: ['add', 'a'] })
    expect(installCommand('yarn', ['a'])).toEqual({ file: 'yarn', args: ['add', 'a'] })
    expect(installCommand('npm', ['a'])).toEqual({ file: 'npm', args: ['install', '--save', 'a'] })
    expect(installCommand('bun', ['a'])).toEqual({ file: 'bun', args: ['add', 'a'] })
  })
})

explain('the key it is given', () => {
  it('takes a public one and a secret one', () => {
    expect(assertKey('nekolog_pk_abc123')).toBe('nekolog_pk_abc123')
    expect(assertKey('nekolog_sk_abc123')).toBe('nekolog_sk_abc123')
  })

  it('trims it', () => {
    expect(assertKey('  nekolog_pk_abc123\n')).toBe('nekolog_pk_abc123')
  })

  it.each([undefined, '', '   '])('takes %j as no key at all', (value) => {
    expect(assertKey(value)).toBeUndefined()
  })

  it.each([
    'abc123',
    'nekolog_xx_abc',
    'nekolog_pk_',
    'nekolog_pk_abc 123',
    'nekolog_pk_abc\nEVIL=1',
  ])('refuses %j rather than writing it', (value) => {
    expect(() => assertKey(value)).toThrow(InitRefused)
  })
})

explain('what goes into the env file', () => {
  it('asks a server project for the secret key', () => {
    expect(entriesFor('express').map((entry) => entry.name)).toEqual([
      'NEKOLOG_KEY',
      'NEKOLOG_SERVICE',
    ])
  })

  it('asks a browser project for the public one, and says it ships', () => {
    const entries = entriesFor('react')

    expect(entries[0]?.name).toBe('VITE_NEKOLOG_KEY')
    expect(entries[0]?.value).toBe(PLACEHOLDER_PUBLIC)
    expect(entries[0]?.note).toContain('bundle')
  })

  it('asks next for both, because it is both', () => {
    expect(entriesFor('next').map((entry) => entry.name)).toContain('NEKOLOG_KEY')
    expect(entriesFor('next').map((entry) => entry.name)).toContain('NEXT_PUBLIC_NEKOLOG_KEY')
  })

  it('puts a secret key only where a secret key belongs', () => {
    const entries = entriesFor('next', 'nekolog_sk_abc')

    expect(entries.find((entry) => entry.name === 'NEKOLOG_KEY')?.value).toBe('nekolog_sk_abc')
    expect(entries.find((entry) => entry.name === 'NEXT_PUBLIC_NEKOLOG_KEY')?.value).toBe(
      PLACEHOLDER_PUBLIC,
    )
  })

  it('puts a public key only where a public key belongs', () => {
    const entries = entriesFor('next', 'nekolog_pk_abc')

    expect(entries.find((entry) => entry.name === 'NEXT_PUBLIC_NEKOLOG_KEY')?.value).toBe(
      'nekolog_pk_abc',
    )
    expect(entries.find((entry) => entry.name === 'NEKOLOG_KEY')?.value).toBe(PLACEHOLDER_SECRET)
  })
})

explain('merging into an env file that already exists', () => {
  it('adds what is missing and keeps the rest', () => {
    const plan = planEnv('DATABASE_URL=postgres://x\n', entriesFor('express'))

    expect(plan.contents).toContain('DATABASE_URL=postgres://x')
    expect(plan.contents).toContain('NEKOLOG_KEY=')
    expect(plan.added).toHaveLength(2)
  })

  it('never writes a name that is already there', () => {
    const plan = planEnv('NEKOLOG_KEY=nekolog_sk_mine\n', entriesFor('express'))

    expect(plan.contents).not.toContain(PLACEHOLDER_SECRET)
    expect(plan.kept).toEqual(['NEKOLOG_KEY'])
    expect(plan.added.map((entry) => entry.name)).toEqual(['NEKOLOG_SERVICE'])
  })

  it('changes nothing when everything is already there', () => {
    const current = 'NEKOLOG_KEY=mine\nNEKOLOG_SERVICE=mine\n'

    expect(planEnv(current, entriesFor('express')).contents).toBe(current)
  })

  it('does not count a commented line as a name', () => {
    expect(namesIn('# NEKOLOG_KEY=nope\nREAL=1\n')).toEqual(new Set(['REAL']))
  })

  it('reads a name written with export in front', () => {
    expect(namesIn('export NEKOLOG_KEY=mine\n')).toEqual(new Set(['NEKOLOG_KEY']))
  })

  it('keeps every name readable when the file did not end with a newline', () => {
    const plan = planEnv('A=1', entriesFor('express'))

    expect(plan.contents.split('\n')).toContain('A=1')
    expect(namesIn(plan.contents)).toEqual(new Set(['A', 'NEKOLOG_KEY', 'NEKOLOG_SERVICE']))
  })
})

explain('running init', () => {
  it('writes the env, installs the right package, and says what it did', async () => {
    const files = workspace({
      'package.json': manifest({ hono: '4' }),
      'pnpm-lock.yaml': '',
    })
    const ran: Array<[string, readonly string[]]> = []

    const report = await init({
      workspace: files,
      run: (file, args) => {
        ran.push([file, args])
        return Promise.resolve(0)
      },
    })

    expect(report.flavour).toBe('hono')
    expect(report.manager).toBe('pnpm')
    expect(ran).toEqual([['pnpm', ['add', '@nekolog-io/hono', '@nekolog-io/node']]])
    expect(files.files['.env']).toContain('NEKOLOG_KEY=')
    expect(describe(report).join('\n')).toContain('hono')
  })

  it('writes the env but runs nothing when told not to install', async () => {
    const files = workspace({ 'package.json': manifest({ express: '5' }) })
    let ranAnything = false

    const report = await init({
      workspace: files,
      install: false,
      run: () => {
        ranAnything = true
        return Promise.resolve(0)
      },
    })

    expect(ranAnything).toBe(false)
    expect(report.install).toBeNull()
    expect(files.files['.env']).toBeDefined()
    expect(describe(report).join('\n')).toContain('Install it yourself')
  })

  it('keeps the env it wrote when the install fails, and says so', async () => {
    const files = workspace({ 'package.json': manifest({ express: '5' }) })

    await expect(init({ workspace: files, run: () => Promise.resolve(1) })).rejects.toThrow(
      InitRefused,
    )

    expect(files.files['.env']).toContain('NEKOLOG_KEY=')
  })

  it('refuses a folder with no package.json instead of making one', async () => {
    const files = workspace({})

    await expect(init({ workspace: files })).rejects.toThrow(/no package.json/)
    expect(Object.keys(files.files)).toEqual([])
  })

  it('refuses a package.json it cannot read, and writes nothing', async () => {
    const files = workspace({ 'package.json': '{ not json' })

    await expect(init({ workspace: files })).rejects.toThrow(/not valid JSON/)
    expect(files.files['.env']).toBeUndefined()
  })

  it('refuses a key that is not one, before touching anything', async () => {
    const files = workspace({ 'package.json': manifest({ express: '5' }) })

    await expect(init({ workspace: files, key: 'hunter2' })).rejects.toThrow(InitRefused)
    expect(files.files['.env']).toBeUndefined()
  })

  it('never overwrites a key the project already had', async () => {
    const files = workspace({
      'package.json': manifest({ express: '5' }),
      '.env': 'NEKOLOG_KEY=nekolog_sk_the_real_one\n',
    })

    await init({ workspace: files, install: false, key: 'nekolog_sk_a_different_one' })

    expect(files.files['.env']).toContain('nekolog_sk_the_real_one')
    expect(files.files['.env']).not.toContain('a_different_one')
  })
})
