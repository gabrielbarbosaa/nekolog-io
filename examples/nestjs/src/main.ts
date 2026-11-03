import 'reflect-metadata'
import { installProcessHooks, type Logger, NEKOLOG_LOGGER } from '@nekolog-io/nestjs'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.ts'

export async function start(): Promise<string> {
  const app = await NestFactory.create(AppModule, { logger: false })
  const logger = app.get<Logger>(NEKOLOG_LOGGER)

  installProcessHooks(logger)

  await app.listen(Number(process.env.PORT ?? 3101), '127.0.0.1')
  return (await app.getUrl()).replace('[::1]', '127.0.0.1')
}

const url = await start()
process.stdout.write(`the nestjs example is listening on ${url}\n`)
