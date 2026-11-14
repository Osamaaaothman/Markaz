// Configure an already extracted official SDK; no vendor binaries enter the repository.
import { existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const sdk = resolve(process.env.ZATCA_SDK_DIR ?? "docs/vendor/zatca/sdk");
const paths = {
  xsdPath: "Data/Schemas/xsds/UBL2.1/xsd/maindoc/UBL-Invoice-2.1.xsd",
  enSchematron: "Data/Rules/schematrons/CEN-EN16931-UBL.xsl",
  zatcaSchematron: "Data/Rules/schematrons/20210819_ZATCA_E-invoice_Validation_Rules.xsl",
  certPath: "Data/Certificates/cert.pem",
  privateKeyPath: "Data/Certificates/ec-secp256k1-priv-key.pem",
  pihPath: "Data/PIH/pih.txt",
  inputPath: "Data/Input",
  usagePathFile: "Configuration/usage.txt",
};
for (const relative of ["Apps/zatca-einvoicing-sdk-238-R3.4.8.jar", "Data/Samples/Standard/Invoice/Standard_Invoice.xml", ...Object.values(paths)]) {
  if (!existsSync(join(sdk, relative))) throw new Error(`Incomplete ZATCA SDK: ${relative} missing under ${sdk}`);
}
const java = spawnSync("java", ["-version"], { encoding: "utf8" });
const major = Number(/version "(\d+)/.exec(`${java.stdout}\n${java.stderr}`)?.[1]);
if (java.error || java.status !== 0 || !(major >= 11 && major < 15)) {
  throw new Error("The official SDK requires Java >=11 and <15. Use Java 11 on PATH (CI uses Temurin 11).");
}
writeFileSync(join(sdk, "Configuration/config.json"), JSON.stringify(Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, join(sdk, relative)])), null, 2) + "\n");
console.log("Official ZATCA SDK 3.4.8 configured; Java and required files available.");
