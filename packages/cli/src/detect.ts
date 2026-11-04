export type Flavour =
  | 'next'
  | 'nestjs'
  | 'react'
  | 'express'
  | 'fastify'
  | 'hono'
  | 'browser'
  | 'node'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export type Choice = {
  flavour: Flavour
  packages: readonly string[]
  because: string
}

export type Manifest = {
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}

export const LOCKFILES: Readonly<Record<string, PackageManager>> = {
  'pnpm-lock.yaml': 'pnpm',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
}

export function dependenciesOf(manifest: Manifest | undefined): Set<string> {
  const found = new Set<string>()
  for (const group of [
    manifest?.dependencies,
    manifest?.devDependencies,
    manifest?.peerDependencies,
  ]) {
    if (typeof group !== 'object' || group === null) {
      continue
    }
    for (const name of Object.keys(group)) {
      found.add(name)
    }
  }
  return found
}

const ORDER: ReadonlyArray<readonly [string, Flavour, string]> = [
  ['next', 'next', 'next is a dependency'],
  ['@nestjs/core', 'nestjs', '@nestjs/core is a dependency'],
  ['@nestjs/common', 'nestjs', '@nestjs/common is a dependency'],
  ['fastify', 'fastify', 'fastify is a dependency'],
  ['hono', 'hono', 'hono is a dependency'],
  ['express', 'express', 'express is a dependency'],
  ['react-dom', 'react', 'react-dom is a dependency'],
  ['react', 'react', 'react is a dependency'],
  ['vite', 'browser', 'vite is a dependency and react is not'],
]

const PACKAGES: Readonly<Record<Flavour, readonly string[]>> = {
  next: ['@nekolog-io/next'],
  nestjs: ['@nekolog-io/nestjs'],
  react: ['@nekolog-io/react'],
  express: ['@nekolog-io/express', '@nekolog-io/node'],
  fastify: ['@nekolog-io/fastify', '@nekolog-io/node'],
  hono: ['@nekolog-io/hono', '@nekolog-io/node'],
  browser: ['@nekolog-io/browser'],
  node: ['@nekolog-io/node'],
}

export function chooseFlavour(manifest: Manifest | undefined): Choice {
  const found = dependenciesOf(manifest)

  for (const [dependency, flavour, because] of ORDER) {
    if (found.has(dependency)) {
      return { flavour, packages: PACKAGES[flavour], because }
    }
  }

  return { flavour: 'node', packages: PACKAGES.node, because: 'nothing else matched' }
}

export function choosePackageManager(present: readonly string[]): PackageManager {
  for (const [lockfile, manager] of Object.entries(LOCKFILES)) {
    if (present.includes(lockfile)) {
      return manager
    }
  }
  return 'npm'
}

export function installCommand(
  manager: PackageManager,
  packages: readonly string[],
): { file: string; args: string[] } {
  if (manager === 'yarn') {
    return { file: 'yarn', args: ['add', ...packages] }
  }
  if (manager === 'npm') {
    return { file: 'npm', args: ['install', '--save', ...packages] }
  }
  return { file: manager, args: ['add', ...packages] }
}
