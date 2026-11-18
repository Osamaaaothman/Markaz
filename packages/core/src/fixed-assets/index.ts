// Public API of the fixed-assets module (docs/02-ARCHITECTURE-RULES.md section 2). Other modules import from here only.
export * from "./depreciation.js";
export { FixedAssetError, type FixedAssetErrorCode, type FixedAssetActor } from "./fixed-asset-common.js";
export * from "./asset-category.service.js";
export * from "./fixed-asset.service.js";
export * from "./depreciation-run.service.js";
export * from "./disposal.service.js";
export * from "./fixed-asset-reports.service.js";
