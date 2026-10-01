import { ArrayUnique, IsArray, IsString } from "class-validator";

export class AssignUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds!: string[];
}
