import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { DocumentTrailService, DocumentTrailError } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { AuthenticatedOnly } from "../identity/authenticated-only.decorator.js";

@Controller("v1/document-trail")
export class DocumentTrailController {
  constructor(private readonly service: DocumentTrailService) {}
  @Get(":kind/:id") @AuthenticatedOnly() async get(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    try {
      return await this.service.trail(kind, id, actor);
    } catch (error) {
      if (error instanceof DocumentTrailError) throw new NotFoundException();
      throw error;
    }
  }
}
