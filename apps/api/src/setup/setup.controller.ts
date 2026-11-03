import { Body, Controller, ForbiddenException, Get, Inject, Post } from "@nestjs/common";
import { MappingSuggestionService, SetupStatusService, type ApplySuggestionResult, type IPermissionService, type MappingSuggestion, type SetupStatus } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { PERMISSION_SERVICE } from "../identity/identity.tokens.js";
import { ApplyMappingSuggestionsDto } from "./setup.dto.js";

// The first-run checklist and the proposed account mappings. Proposals only become real when a person confirms them.
@Controller("v1/setup")
export class SetupController {
  constructor(
    private readonly status: SetupStatusService,
    private readonly suggestions: MappingSuggestionService,
    @Inject(PERMISSION_SERVICE) private readonly permissions: IPermissionService,
  ) {}

  @Get("status")
  @RequirePermission("account_mapping", "read")
  getStatus(@CurrentUser() actor: CurrentUserPayload): Promise<SetupStatus> {
    return this.status.status(actor.companyId);
  }

  @Get("mapping-suggestions")
  @RequirePermission("account_mapping", "read")
  getSuggestions(@CurrentUser() actor: CurrentUserPayload): Promise<readonly MappingSuggestion[]> {
    return this.suggestions.suggestions(actor.companyId);
  }

  // Creates the accounts the chosen proposals need and maps them. Changing the mapping is not enough: it also creates accounts, so
  // the caller must be allowed to do that too.
  @Post("mapping-suggestions/apply")
  @RequirePermission("account_mapping", "update")
  async apply(@Body() dto: ApplyMappingSuggestionsDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<readonly ApplySuggestionResult[]> {
    if (!(await this.permissions.can(actor.id, "create", "account"))) throw new ForbiddenException("Creating the accounts these proposals need requires the permission to create accounts");
    return this.suggestions.apply(dto.keys, actor, correlationId);
  }
}
