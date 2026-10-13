/** Additive role check: T0 owns scripts/check/boundaries.ts. Uses the TS parser,
 * follows *all* runtime exports (including barrels), excludes type-only edges,
 * rejects unresolved/dynamic/require edges and symlinks. Package code is trusted
 * at reviewed lockfile versions; this checks first-party source reachability. */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
export type Role = 'buyer' | 'seller-worker';
const defaults = { buyer: 'scripts/runtime/buyer.ts', 'seller-worker': 'src/seller/worker.ts' };
export function checkRole(root: string, role: Role, entry = defaults[role]): string[] {
  const seen = new Set<string>();
  function walk(local: string): void {
    if (seen.has(local)) return;
    const allowed = role === 'buyer' ? local === 'scripts/runtime/buyer.ts' || local.startsWith('src/mcp/') || local.startsWith('src/wire/')
      : local === 'src/seller/worker.ts' || local === 'src/seller/preparation.ts' || local === 'src/seller/ports.ts' || local.startsWith('src/wire/');
    if (!allowed) throw new Error(`ROLE_IMPORT_DENIED: ${role} -> ${local}`);
    const path = resolve(root, local);
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error('ROLE_SYMLINK_DENIED');
    seen.add(local); const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function edge(specifier: string): void {
      if (specifier.startsWith('.')) {
        if (!specifier.endsWith('.ts')) throw new Error('ROLE_IMPORT_EXTENSION');
        walk(relative(root, resolve(dirname(path), specifier))); return;
      }
      const builtins = role === 'buyer' ? ['node:crypto', 'node:buffer', 'node:util', 'node:net', 'node:stream'] : ['node:crypto', 'node:buffer', 'node:util'];
      if (builtins.includes(specifier)) return;
      const packages = ['canonicalize', 'jsonc-parser', 'zod', ...(role === 'buyer' ? ['@modelcontextprotocol/sdk'] : [])];
      if (!packages.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`))) throw new Error(`ROLE_PACKAGE_DENIED: ${specifier}`);
    }
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (!typeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) edge(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && ['require', 'eval', 'Function'].includes(node.expression.text))) throw new Error('ROLE_DYNAMIC_CODE_DENIED');
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') throw new Error('ROLE_DYNAMIC_CODE_DENIED');
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  walk(entry); return [...seen].sort();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  for (const role of ['buyer', 'seller-worker'] as const) console.log(JSON.stringify({ role, result: 'PASS', files: checkRole(root, role) }));
}
