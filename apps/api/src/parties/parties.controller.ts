import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { PartyService, type PartyListPage, type PartySummary } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { CreatePartyDto } from "./dto/create-party.dto.js";
import { PartiesQueryDto } from "./dto/parties-query.dto.js";
import { UpdatePartyDto } from "./dto/update-party.dto.js";

@Controller("v1/parties")
export class PartiesController {
  constructor(private readonly parties: PartyService) {}

  @Get()
  @RequirePermission("party", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: PartiesQueryDto): Promise<PartyListPage> {
    return this.parties.list(actor.companyId, query);
  }

  @Post()
  @RequirePermission("party", "create")
  create(
    @Body() dto: CreatePartyDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PartySummary> {
    return this.parties.create(dto, actor, correlationId);
  }

  @Patch(":id")
  @RequirePermission("party", "update")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdatePartyDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PartySummary> {
    const party = await this.parties.update(id, dto, actor, correlationId);
    if (!party) throw new NotFoundException("Party not found");
    return party;
  }
}
