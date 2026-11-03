import { NekologModule } from '@nekolog-io/nestjs'
import { Module } from '@nestjs/common'
import { OrdersController } from './orders.controller.ts'

@Module({
  imports: [
    NekologModule.forRoot({
      privacy: { extraKeys: ['email'] },
      transport: {
        flushIntervalMs: Number(process.env.NEKOLOG_FLUSH_INTERVAL_MS ?? 5_000),
      },
    }),
  ],
  controllers: [OrdersController],
})
export class AppModule {}
