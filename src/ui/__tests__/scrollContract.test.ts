import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === '__tests__' ? [] : e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
}
it('all application scrollers use the shared mobile indicator policy', () => {
  const violations: string[] = [];
  const nativeScrollers = new Set(['ScrollView', 'FlatList', 'SectionList', 'VirtualizedList']);
  for (const path of [...sources('app'), ...sources('src')]) {
    if (path.replaceAll('\\', '/') === 'src/ui/ScrollView.tsx') continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'react-native') continue;
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
      if (ts.isNamespaceImport(clause.namedBindings)) {
        const alias = clause.namedBindings.name.text;
        const visit = (n: ts.Node) => {
          if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === alias && nativeScrollers.has(n.name.text)) violations.push(`${path}: ${n.getText(source)}`);
          ts.forEachChild(n, visit);
        };
        visit(source);
      } else for (const specifier of clause.namedBindings.elements) {
        if (!specifier.isTypeOnly && nativeScrollers.has((specifier.propertyName ?? specifier.name).text)) violations.push(`${path}: ${specifier.getText(source)}`);
      }
    }
  }
  expect(violations).toEqual([]);
});
