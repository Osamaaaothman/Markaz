import { Controller, Get, Query } from "@nestjs/common";
import { AuditQueryService, type AuditLogPage } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { AuditLogQueryDto } from "./audit-log-query.dto.js";

// Read-only. The log is written by the other modules and can be neither changed nor deleted from here or anywhere else.
@Controller("v1")
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get("audit-log")
  @RequirePermission("audit_log", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: AuditLogQueryDto): Promise<AuditLogPage> {
    return this.audit.list(actor.companyId, query);
  }

  // The entity types and users that appear in this company's log, to fill the screen's filters.
  @Get("audit-log/filters")
  @RequirePermission("audit_log", "read")
  filters(@CurrentUser() actor: CurrentUserPayload): ReturnType<AuditQueryService["filters"]> {
    return this.audit.filters(actor.companyId);
  }
}
