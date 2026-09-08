import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { AuthService, type TokenPair } from "./auth.service.js";
import { LoginDto } from "./dto/login.dto.js";
import { RefreshDto } from "./dto/refresh.dto.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { Public } from "./public.decorator.js";

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @CorrelationId() correlationId: string): Promise<TokenPair> {
    return this.auth.login(dto.email, dto.password, correlationId);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @CorrelationId() correlationId: string): Promise<TokenPair> {
    return this.auth.refresh(dto.refreshToken, correlationId);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }
}
