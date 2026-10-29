import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  // If importing .css, allow resolving as file
  if (specifier.endsWith('.css') && context.parentURL && context.parentURL.startsWith('file:')) {
    const parentDir = new URL('.', context.parentURL);
    const cssUrl = new URL(specifier, parentDir);
    return {
      url: cssUrl.href,
      shortCircuit: true,
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // If specifier ends with .js, check if .tsx or .ts exists on disk
    if (specifier.endsWith('.js') && context.parentURL && context.parentURL.startsWith('file:')) {
      const parentDir = new URL('.', context.parentURL);
      const tsxCandidate = new URL(specifier.replace(/\.js$/, '.tsx'), parentDir);
      if (existsSync(fileURLToPath(tsxCandidate))) {
        return {
          url: tsxCandidate.href,
          shortCircuit: true,
        };
      }
      const tsCandidate = new URL(specifier.replace(/\.js$/, '.ts'), parentDir);
      if (existsSync(fileURLToPath(tsCandidate))) {
        return {
          url: tsCandidate.href,
          shortCircuit: true,
        };
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      source: 'export default {};',
      shortCircuit: true,
    };
  }

  if (url.endsWith('.tsx') || url.endsWith('.ts')) {
    const filePath = fileURLToPath(url);
    const source = await readFile(filePath, 'utf8');
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filePath,
    });
    return {
      format: 'module',
      source: result.outputText,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
