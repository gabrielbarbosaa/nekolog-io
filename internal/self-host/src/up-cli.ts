#!/usr/bin/env node
import { up } from './up.ts'

process.exitCode = await up(process.argv.slice(2))
