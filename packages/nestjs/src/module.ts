import type { Logger } from '@nekolog-io/core'
import { createLogger, type NodeLoggerOptions } from '@nekolog-io/node'
import type { DynamicModule, Provider } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { type InterceptorOptions, NekologInterceptor } from './interceptor.ts'
import { NEKOLOG_LOGGER, SDK_NAME, SDK_VERSION } from './tokens.ts'

export type NekologModuleOptions = NodeLoggerOptions & {
  interceptor?: InterceptorOptions | false
  global?: boolean
}

export type NekologModuleAsyncOptions = {
  imports?: DynamicModule['imports']
  inject?: unknown[]
  useFactory: (...args: never[]) => NekologModuleOptions | Promise<NekologModuleOptions>
  global?: boolean
}

export function buildLogger(options: NekologModuleOptions = {}): Logger {
  const { interceptor: _interceptor, global: _global, ...rest } = options
  return createLogger({ sdk: { name: SDK_NAME, version: SDK_VERSION }, ...rest })
}

function interceptorProviders(options: NekologModuleOptions): Provider[] {
  const tuning = options.interceptor
  if (tuning === false) {
    return []
  }
  return [
    {
      provide: APP_INTERCEPTOR,
      useFactory: (logger: Logger) => new NekologInterceptor(logger, tuning ?? {}),
      inject: [NEKOLOG_LOGGER],
    },
  ]
}

// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a module by its class
export class NekologModule {
  static forRoot(options: NekologModuleOptions = {}): DynamicModule {
    return {
      module: NekologModule,
      global: options.global !== false,
      providers: [
        { provide: NEKOLOG_LOGGER, useValue: buildLogger(options) },
        ...interceptorProviders(options),
      ],
      exports: [NEKOLOG_LOGGER],
    }
  }

  static forRootAsync(options: NekologModuleAsyncOptions): DynamicModule {
    return {
      module: NekologModule,
      global: options.global !== false,
      imports: options.imports,
      providers: [
        {
          provide: NEKOLOG_LOGGER,
          useFactory: async (...args: never[]) => buildLogger(await options.useFactory(...args)),
          inject: options.inject as never[],
        },
        {
          provide: APP_INTERCEPTOR,
          useFactory: (logger: Logger) => new NekologInterceptor(logger),
          inject: [NEKOLOG_LOGGER],
        },
      ],
      exports: [NEKOLOG_LOGGER],
    }
  }
}
