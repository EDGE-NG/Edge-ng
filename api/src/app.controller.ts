import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /** Health check, used to confirm the API is running. */
  @Get('health')
  health(): { status: 'ok'; service: 'edge-api' } {
    return { status: 'ok', service: 'edge-api' };
  }
}
