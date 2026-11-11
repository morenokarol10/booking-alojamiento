import { Controller, Get, Redirect } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  @Redirect('/marketplace/', 302)
  getMarketplace(): { url: string; statusCode: number } {
    return { url: '/marketplace/', statusCode: 302 };
  }
}
