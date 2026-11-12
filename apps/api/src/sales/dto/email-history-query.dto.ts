import { IsOptional, IsUUID } from "class-validator";
export class EmailHistoryQueryDto {
  @IsOptional() @IsUUID() cursor?: string;
}
