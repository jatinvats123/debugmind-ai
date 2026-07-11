const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const FUNC_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function collectSourceFiles(projectRoot) {
  const files = [];
  const roots = ['src', 'tests'];
  for (const dir of roots) {
    const abs = path.join(projectRoot, dir);
    if (!fs.existsSync(abs)) continue;
    walkDir(abs, files);
  }
  const serverJs = path.join(projectRoot, 'server.js');
  if (fs.existsSync(serverJs)) files.push(serverJs);
  return files;
}

function walkDir(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkDir(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
}

/** Derive a display name for a function node given its direct parent node. */
function nameFunctionNode(node, parent, relFile) {
  if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
  if (parent) {
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
      return parent.id.name;
    }
    if (parent.type === 'Property' && parent.key) {
      return parent.key.name || parent.key.value;
    }
    if (parent.type === 'MethodDefinition' && parent.key) {
      return parent.key.name;
    }
    if (parent.type === 'AssignmentExpression' && parent.left.type === 'MemberExpression') {
      const prop = parent.left.property;
      if (prop && prop.name) return prop.name;
    }
  }
  return `<anonymous fn @ ${relFile}:${node.loc.start.line}>`;
}

/**
 * Parse the project and build a call index.
 * Re-parses fresh each call so results reflect any edits made mid-session.
 */
function buildIndex(projectRoot) {
  const definitions = []; // {name, file, line, endLine, kind}
  const calls = []; // {caller, callee, receiver, file, line}
  const parseErrors = [];

  for (const absFile of collectSourceFiles(projectRoot)) {
    const relFile = path.relative(projectRoot, absFile).replace(/\\/g, '/');
    const source = fs.readFileSync(absFile, 'utf8');
    let ast;
    try {
      ast = acorn.parse(source, { ecmaVersion: 2022, locations: true, sourceType: 'script' });
    } catch (e) {
      parseErrors.push({ file: relFile, error: e.message });
      continue;
    }

    walk.fullAncestor(ast, (node, _state, ancestors) => {
      if (FUNC_TYPES.has(node.type)) {
        // ancestors includes node itself as the last element; parent is second-to-last
        const parent = ancestors.length >= 2 ? ancestors[ancestors.length - 2] : null;
        const name = nameFunctionNode(node, parent, relFile);
        definitions.push({
          name,
          file: relFile,
          line: node.loc.start.line,
          endLine: node.loc.end.line,
          kind: node.type,
          _node: node,
        });
      }

      if (node.type === 'CallExpression') {
        let callee = null;
        let receiver = null;
        if (node.callee.type === 'Identifier') {
          callee = node.callee.name;
        } else if (node.callee.type === 'MemberExpression' && !node.callee.computed) {
          callee = node.callee.property.name;
          if (node.callee.object.type === 'Identifier') {
            receiver = node.callee.object.name;
          } else if (node.callee.object.type === 'ThisExpression') {
            receiver = 'this';
          }
        }
        if (!callee) return;

        // Find the nearest enclosing function in the ancestor chain (excluding the call itself).
        let caller = `<module: ${relFile}>`;
        for (let i = ancestors.length - 2; i >= 0; i--) {
          const anc = ancestors[i];
          if (FUNC_TYPES.has(anc.type)) {
            caller = nameFunctionNode(anc, i >= 1 ? ancestors[i - 1] : null, relFile);
            break;
          }
        }

        calls.push({ caller, callee, receiver, file: relFile, line: node.loc.start.line });
      }
    });
  }

  return { definitions, calls, parseErrors };
}

function getCallGraph(projectRoot, functionName) {
  const { definitions, calls, parseErrors } = buildIndex(projectRoot);

  const defs = definitions
    .filter((d) => d.name === functionName)
    .map(({ name, file, line, endLine, kind }) => ({ name, file, line, endLine, kind }));

  const callers = calls
    .filter((c) => c.callee === functionName)
    .map((c) => ({
      callingFunction: c.caller,
      at: `${c.file}:${c.line}`,
      via: c.receiver ? `${c.receiver}.${c.callee}()` : `${c.callee}()`,
    }));

  const calleesRaw = calls.filter((c) => c.caller === functionName);
  const callees = calleesRaw.map((c) => ({
    calls: c.receiver ? `${c.receiver}.${c.callee}()` : `${c.callee}()`,
    at: `${c.file}:${c.line}`,
  }));

  if (defs.length === 0 && callers.length === 0 && callees.length === 0) {
    const lower = functionName.toLowerCase();
    const candidates = [...new Set(definitions.map((d) => d.name))]
      .filter((n) => !n.startsWith('<'))
      .filter(
        (n) =>
          n.toLowerCase().includes(lower) ||
          lower.includes(n.toLowerCase()) ||
          isSubsequence(lower, n.toLowerCase()) ||
          levenshteinLite(n.toLowerCase(), lower) <= 3
      )
      .slice(0, 8);
    return {
      found: false,
      message: `No function named "${functionName}" found in the codebase.`,
      didYouMean: candidates,
      parseErrors,
    };
  }

  return {
    found: true,
    function: functionName,
    definedAt: defs,
    callers,
    callees,
    note:
      'Method calls are matched by name; when a call is shown as receiver.name(), verify the receiver type by reading the file.',
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
  };
}

/** True if every character of `needle` appears in `haystack` in order (catches abbreviations like calcSubtotal → calculateSubtotal). */
function isSubsequence(needle, haystack) {
  if (needle.length < 4) return false;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

function levenshteinLite(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

module.exports = { getCallGraph, buildIndex };
