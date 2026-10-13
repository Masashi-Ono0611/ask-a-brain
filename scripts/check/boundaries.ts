import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../../', import.meta.url));
const allowed: Record<string, readonly string[]> = {
  wire: [], common: ['wire'], chain: ['wire', 'common'], broker: ['wire', 'common', 'chain'],
  seller: ['wire', 'common', 'chain'], publish: ['wire', 'common'], mcp: ['wire'], eval: ['wire', 'common'],
};
function files(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []); }
/** Pure entrypoint for bad/clean controls without planting source-tree files. */
export function checkSource(local: string, code: string): number {
  let imports = 0;
  const path = join(root, 'src', local); const module = local.split('/')[0]!;
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  function validate(specifier: string, typeOnly = false): void {
    imports++;
    if (specifier === 'node:sqlite' && local !== 'common/sqlite-store.ts') throw new Error(`SQLITE_BOUNDARY: ${local}`);
    if (module === 'wire' && specifier.startsWith('node:') && !['node:crypto', 'node:buffer', 'node:util'].includes(specifier)) throw new Error(`WIRE_IO_BOUNDARY: ${local}`);
    if (specifier.startsWith('.')) {
      if (!specifier.endsWith('.ts')) throw new Error(`EXPLICIT_TS_IMPORT_REQUIRED: ${local}`);
      const target = relative(join(root, 'src'), resolve(dirname(path), specifier)); const targetModule = target.split('/')[0]!;
      if (target === 'wire/contracts.ts' && module !== 'wire' && !typeOnly) throw new Error(`CONTRACT_TYPE_ONLY: ${local}`);
      if (target.startsWith('..')) throw new Error(`SOURCE_ESCAPE: ${local}`);
      if (targetModule !== module && (!allowed[module]?.includes(targetModule) || (!target.endsWith('/index.ts') && target !== 'wire/contracts.ts'))) throw new Error(`IMPORT_BOUNDARY: ${local} -> ${target}`);
    } else if (!specifier.startsWith('node:')) {
      const permitted = module === 'wire' ? ['canonicalize', 'jsonc-parser', 'zod'] : module === 'chain' ? ['@solana/kit'] : module === 'mcp' ? ['@modelcontextprotocol/sdk'] : [];
      if (!permitted.some((packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`))) throw new Error(`PACKAGE_BOUNDARY: ${local}`);
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isDecorator(node)) throw new Error(`NONERASABLE_SYNTAX: ${local}`);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) validate(node.moduleSpecifier.text, ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      if (node.expression.kind !== ts.SyntaxKind.ImportKeyword || !argument || !ts.isStringLiteral(argument)) throw new Error(`DYNAMIC_IMPORT_BOUNDARY: ${local}`);
      validate(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source); return imports;
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let imports = 0;
  for (const path of files(join(root, 'src'))) imports += checkSource(relative(join(root, 'src'), path), readFileSync(path, 'utf8'));
  const { checkRole } = await import('../runtime/reachability.ts');
  for (const role of ['buyer', 'seller-worker'] as const) {
    try { if (checkRole(root, role).length === 0) throw new Error('ROLE_EMPTY_REACHABILITY'); }
    catch (error) { console.error(`role bundle reachability FAIL (${role}): ${(error as Error).message}`); process.exit(1); }
  }
  console.log(`import boundaries PASS: ${imports} imports/exports; role bundle reachability PASS (buyer, seller-worker)`);
}
