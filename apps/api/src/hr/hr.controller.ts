import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  EmployeeService,
  EndOfServiceError,
  EndOfServiceService,
  PayrollRunError,
  PayrollRunService,
  SalaryAdvanceError,
  SalaryAdvanceService,
  UnmappedAccountError,
  WpsFileError,
  buildWpsWagesFile,
  type EmployeeListPage,
  type EmployeeSummary,
  type EndOfServiceResult,
  type PayrollRunResult,
  type SalaryAdvanceResult,
  type SalaryAdvanceSummary,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateEmployeeDto, CreatePayrollRunDto, EmployeesQueryDto, GrantSalaryAdvanceDto, SetWpsSettingsDto, SettleEndOfServiceDto, UpdateEmployeeDto } from "./dto/hr-dtos.js";

@Controller("v1")
export class HrController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly payrollRuns: PayrollRunService,
    private readonly salaryAdvances: SalaryAdvanceService,
    private readonly endOfService: EndOfServiceService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Employees ────────────────────────────────────────────────────────────────

  @Get("employees")
  @RequirePermission("employee", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: EmployeesQueryDto): Promise<EmployeeListPage> {
    return this.employees.list(actor.companyId, query);
  }

  @Get("employees/all")
  @RequirePermission("employee", "read")
  listAll(@CurrentUser() actor: CurrentUserPayload): Promise<readonly EmployeeSummary[]> {
    return this.employees.listAllActive(actor.companyId);
  }

  @Get("employees/:id")
  @RequirePermission("employee", "read")
  async get(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<EmployeeSummary> {
    const employee = await this.employees.get(id, actor.companyId);
    if (!employee) throw new NotFoundException("Employee not found");
    return employee;
  }

  @Post("employees")
  @RequirePermission("employee", "create")
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<EmployeeSummary> {
    return this.employees.create(
      {
        name: dto.name,
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        nationalId: dto.nationalId,
        isSaudi: dto.isSaudi,
        ...(dto.gosiLegacyTrack !== undefined ? { gosiLegacyTrack: dto.gosiLegacyTrack } : {}),
        bankIban: dto.bankIban,
        ...(dto.bankName !== undefined ? { bankName: dto.bankName } : {}),
        hireDate: new Date(dto.hireDate),
        basicSalary: dto.basicSalary,
        ...(dto.housingAllowance !== undefined ? { housingAllowance: dto.housingAllowance } : {}),
        ...(dto.otherAllowances !== undefined ? { otherAllowances: dto.otherAllowances } : {}),
      },
      actor,
      correlationId,
    );
  }

  @Put("employees/:id")
  @RequirePermission("employee", "update")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<EmployeeSummary> {
    const updated = await this.employees.update(
      id,
      {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.isSaudi !== undefined ? { isSaudi: dto.isSaudi } : {}),
        ...(dto.gosiLegacyTrack !== undefined ? { gosiLegacyTrack: dto.gosiLegacyTrack } : {}),
        ...(dto.bankIban !== undefined ? { bankIban: dto.bankIban } : {}),
        ...(dto.bankName !== undefined ? { bankName: dto.bankName } : {}),
        ...(dto.basicSalary !== undefined ? { basicSalary: dto.basicSalary } : {}),
        ...(dto.housingAllowance !== undefined ? { housingAllowance: dto.housingAllowance } : {}),
        ...(dto.otherAllowances !== undefined ? { otherAllowances: dto.otherAllowances } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      actor,
      correlationId,
    );
    if (!updated) throw new NotFoundException("Employee not found");
    return updated;
  }

  // ── Payroll runs ─────────────────────────────────────────────────────────────

  @Get("payroll-runs")
  @RequirePermission("payroll_run", "read")
  listRuns(@CurrentUser() actor: CurrentUserPayload) {
    return this.payrollRuns.list(actor.companyId);
  }

  @Get("payroll-runs/:id")
  @RequirePermission("payroll_run", "read")
  async getRun(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload) {
    const run = await this.payrollRuns.get(id, actor.companyId);
    if (!run) throw new NotFoundException("Payroll run not found");
    return run;
  }

  @Post("payroll-runs")
  @RequirePermission("payroll_run", "create")
  createRun(
    @Body() dto: CreatePayrollRunDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<PayrollRunResult> {
    return this.mapPayrollErrors(
      this.payrollRuns.create({ periodYear: dto.periodYear, periodMonth: dto.periodMonth, runDate: new Date(dto.runDate) }, actor, correlationId, idempotencyKey),
    );
  }

  // ── Salary advances ──────────────────────────────────────────────────────────

  @Get("salary-advances")
  @RequirePermission("salary_advance", "read")
  listAdvances(@CurrentUser() actor: CurrentUserPayload, @Query("employeeId") employeeId?: string): Promise<readonly SalaryAdvanceSummary[]> {
    return employeeId ? this.salaryAdvances.listForEmployee(employeeId, actor.companyId) : this.salaryAdvances.listAll(actor.companyId);
  }

  @Post("salary-advances")
  @RequirePermission("salary_advance", "create")
  grantAdvance(
    @Body() dto: GrantSalaryAdvanceDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SalaryAdvanceResult> {
    return this.mapAdvanceErrors(
      this.salaryAdvances.grant(
        { employeeId: dto.employeeId, grantDate: new Date(dto.grantDate), amount: dto.amount, installmentAmount: dto.installmentAmount, cashAccountId: dto.cashAccountId },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }

  // ── End of service ───────────────────────────────────────────────────────────

  @Post("end-of-service-settlements")
  @RequirePermission("end_of_service", "create")
  settleEndOfService(
    @Body() dto: SettleEndOfServiceDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<EndOfServiceResult> {
    return this.mapEndOfServiceErrors(
      this.endOfService.settle({ employeeId: dto.employeeId, terminationDate: new Date(dto.terminationDate), reason: dto.reason }, actor, correlationId, idempotencyKey),
    );
  }

  // ── WPS (mudad) settings and export ──────────────────────────────────────────

  @Get("company/wps-settings")
  @RequirePermission("company", "read")
  async getWpsSettings(@CurrentUser() actor: CurrentUserPayload) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { wpsBankSarieId: true, wpsBankAccountNumber: true, wpsMolEstablishmentId: true },
    });
    return {
      bankSarieId: company.wpsBankSarieId,
      bankAccountNumber: company.wpsBankAccountNumber,
      molEstablishmentId: company.wpsMolEstablishmentId,
      isComplete: Boolean(company.wpsBankSarieId && company.wpsBankAccountNumber && company.wpsMolEstablishmentId),
    };
  }

  @Put("company/wps-settings")
  @RequirePermission("company", "update")
  async setWpsSettings(@Body() dto: SetWpsSettingsDto, @CurrentUser() actor: CurrentUserPayload) {
    await this.prisma.company.update({
      where: { id: actor.companyId },
      data: { wpsBankSarieId: dto.bankSarieId, wpsBankAccountNumber: dto.bankAccountNumber, wpsMolEstablishmentId: dto.molEstablishmentId, updatedBy: actor.id, version: { increment: 1 } },
    });
    return { bankSarieId: dto.bankSarieId, bankAccountNumber: dto.bankAccountNumber, molEstablishmentId: dto.molEstablishmentId, isComplete: true };
  }

  // The wages file for a run, built fresh from the stored payslip lines every time -- never
  // stored, so there is nothing stale to serve.
  @Get("payroll-runs/:id/wps-file")
  @RequirePermission("payroll_run", "read")
  async downloadWpsFile(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @Res({ passthrough: true }) res: Response): Promise<string> {
    const run = await this.payrollRuns.get(id, actor.companyId);
    if (!run) throw new NotFoundException("Payroll run not found");

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { wpsBankSarieId: true, wpsBankAccountNumber: true, wpsMolEstablishmentId: true },
    });
    if (!company.wpsBankSarieId || !company.wpsBankAccountNumber || !company.wpsMolEstablishmentId) {
      throw new BadRequestException("Set the company's WPS bank and establishment details (Settings) before exporting a wages file");
    }

    try {
      const file = buildWpsWagesFile({
        company: { bankSarieId: company.wpsBankSarieId, bankAccountNumber: company.wpsBankAccountNumber, molEstablishmentId: company.wpsMolEstablishmentId },
        valueDate: new Date(run.runDate),
        fileReference: run.number,
        employees: run.lines.map((l) => ({
          iban: l.bankIban,
          name: l.employeeName,
          nationalId: l.nationalId,
          basicSalary: l.basicSalary,
          housingAllowance: l.housingAllowance,
          otherEarnings: l.otherAllowances,
          deductions: (Number(l.gosiEmployeeShare) + Number(l.advanceDeduction)).toFixed(4),
        })),
      });
      res.header("Content-Type", "text/plain; charset=utf-8");
      res.header("Content-Disposition", `attachment; filename="${run.number}-wages.txt"`);
      return file;
    } catch (error) {
      if (error instanceof WpsFileError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  // ── Error mapping ────────────────────────────────────────────────────────────

  private async mapPayrollErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof PayrollRunError)) throw error;
      switch (error.code) {
        case "PERIOD_ALREADY_RUN":
          throw new ConflictException(error.message);
        case "NO_ACTIVE_EMPLOYEES":
        case "NO_OPEN_PERIOD":
          throw new BadRequestException(error.message);
      }
    }
  }

  private async mapAdvanceErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof SalaryAdvanceError)) throw error;
      switch (error.code) {
        case "EMPLOYEE_NOT_FOUND":
        case "CASH_ACCOUNT_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "CASH_ACCOUNT_INVALID":
        case "NO_OPEN_PERIOD":
          throw new BadRequestException(error.message);
      }
    }
  }

  private async mapEndOfServiceErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof EndOfServiceError)) throw error;
      switch (error.code) {
        case "EMPLOYEE_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "ALREADY_TERMINATED":
          throw new ConflictException(error.message);
        case "TERMINATION_BEFORE_HIRE":
        case "NO_OPEN_PERIOD":
          throw new BadRequestException(error.message);
      }
    }
  }
}
