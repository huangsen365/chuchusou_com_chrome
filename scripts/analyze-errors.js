#!/usr/bin/env node
const { execSync } = require('child_process');

try {
  const output = execSync('npx eslint . --format json', {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  const data = JSON.parse(output);

  const errors = [];
  data.forEach(file => {
    file.messages.forEach(msg => {
      if (msg.severity === 2) { // errors only
        errors.push({
          file: file.filePath.split('/').slice(-2).join('/'),
          fullPath: file.filePath,
          line: msg.line,
          rule: msg.ruleId,
          message: msg.message
        });
      }
    });
  });

  // Group by rule
  const byRule = {};
  errors.forEach(e => {
    if (!byRule[e.rule]) byRule[e.rule] = [];
    byRule[e.rule].push(e);
  });

  console.log('=== ERRORS BY RULE ===\n');
  Object.entries(byRule)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([rule, errs]) => {
      console.log(`### ${rule} (${errs.length} errors)`);
      // Show unique undefined vars for no-undef
      if (rule === 'no-undef') {
        const undefs = [...new Set(errs.map(e => {
          const match = e.message.match(/'([^']+)'/);
          return match ? match[1] : e.message;
        }))];
        console.log(`  Undefined: ${undefs.join(', ')}`);
      }
      console.log('');
    });

  // Group by file
  const byFile = {};
  errors.forEach(e => {
    if (!byFile[e.file]) byFile[e.file] = [];
    byFile[e.file].push(e);
  });

  console.log('\n=== ERRORS BY FILE ===\n');
  Object.entries(byFile)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([file, errs]) => {
      console.log(`### ${file} (${errs.length} errors)`);
      errs.slice(0, 5).forEach(e => {
        console.log(`  L${e.line}: [${e.rule}] ${e.message}`);
      });
      if (errs.length > 5) console.log(`  ... and ${errs.length - 5} more`);
      console.log('');
    });

  console.log(`\n=== TOTAL: ${errors.length} errors ===`);

} catch (err) {
  if (err.stdout) {
    // ESLint returns exit code 1 when there are errors, but still outputs JSON
    try {
      const data = JSON.parse(err.stdout);
      // Same processing as above
      const errors = [];
      data.forEach(file => {
        file.messages.forEach(msg => {
          if (msg.severity === 2) {
            errors.push({
              file: file.filePath.split('/').slice(-2).join('/'),
              line: msg.line,
              rule: msg.ruleId,
              message: msg.message
            });
          }
        });
      });

      const byRule = {};
      errors.forEach(e => {
        if (!byRule[e.rule]) byRule[e.rule] = [];
        byRule[e.rule].push(e);
      });

      console.log('=== ERRORS BY RULE ===\n');
      Object.entries(byRule)
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([rule, errs]) => {
          console.log(`### ${rule} (${errs.length} errors)`);
          if (rule === 'no-undef') {
            const undefs = [...new Set(errs.map(e => {
              const match = e.message.match(/'([^']+)'/);
              return match ? match[1] : e.message;
            }))];
            console.log(`  Undefined: ${undefs.join(', ')}`);
          }
          console.log('');
        });

      const byFile = {};
      errors.forEach(e => {
        if (!byFile[e.file]) byFile[e.file] = [];
        byFile[e.file].push(e);
      });

      console.log('\n=== ERRORS BY FILE ===\n');
      Object.entries(byFile)
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([file, errs]) => {
          console.log(`### ${file} (${errs.length} errors)`);
          errs.slice(0, 5).forEach(e => {
            console.log(`  L${e.line}: [${e.rule}] ${e.message}`);
          });
          if (errs.length > 5) console.log(`  ... and ${errs.length - 5} more`);
          console.log('');
        });

      console.log(`\n=== TOTAL: ${errors.length} errors ===`);
    } catch (parseErr) {
      console.error('Failed to parse ESLint output:', parseErr.message);
      console.error(err.stdout);
    }
  } else {
    console.error('Error:', err.message);
  }
}
